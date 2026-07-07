"""Wavebrowser interesting-message flagger.

A CPU-only companion to the transcriber. It reads transcription *text* from the
same MongoDB collection (never audio, never the GPU, never the recordings
volume) and asks a small local LLM to flag the transmissions worth a human's
attention against a configurable prompt.

Cadence is message-rate driven, not time-of-day: the poller reacts to the
transcriber's writes. Each poll it looks at the un-flagged backlog and processes
it once enough accumulate (FLAG_BATCH_SIZE) or the oldest has waited long enough
(FLAG_MAX_WAIT) — so busy periods form full batches and quiet periods still get
flushed. It deliberately runs as its own process, NOT inside the transcriber: a
llama.cpp call is seconds per batch and would stall the transcriber's single
worker thread (the same reason whisper isn't run inline in the inotify callback).

To keep idle memory near zero the model is loaded per drain and released
afterwards; mmap keeps the GGUF warm in the OS page cache so reloads are cheap.

All configuration is via environment variables (see Config).
"""

import gc
import os
import sys
import json
import time
import signal
import logging
from pathlib import Path
from datetime import datetime, timezone

import pymongo
from pymongo import UpdateOne

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(message)s",
)
log = logging.getLogger("flagger")

# Default system prompt — the model's full instructions for what to flag.
# FLAG_PROMPT overrides this and is the ENTIRE system prompt (one block), not a
# fragment glued onto a hidden prefix. Kept deliberately generic — tune it to
# whatever "interesting" means for your own feed.
DEFAULT_PROMPT = (
    "You are triaging short radio transmission transcriptions. Flag any "
    "transmission that is interesting, unusual, or funny - anything that stands "
    "out from routine traffic and a listener might want to review. Ignore routine "
    "check-ins, radio tests, acknowledgements, and unintelligible fragments."
)

# JSON schema the model output is constrained to (via llama.cpp's grammar-backed
# response_format), so a small model always returns something parseable. The
# model lists ONLY the interesting items by their 1-based number in the batch;
# anything omitted is treated as not interesting (better recall than a per-item
# bool, and a trivially small output).
RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "interesting": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer"},
                    "reason": {"type": "string"},
                },
                "required": ["index", "reason"],
            },
        }
    },
    "required": ["interesting"],
}

REASON_MAX_LEN = 300


class Config:
    def __init__(self):
        self.mongo_uri = os.environ.get("MONGODB_URI")
        if not self.mongo_uri:
            log.error("MONGODB_URI is required")
            sys.exit(1)
        self.mongo_db = os.environ.get("MONGODB_DB", "transcriber")
        self.mongo_collection = os.environ.get("MONGODB_COLLECTION", "transcriptions")

        # Must match TRANSCRIPTION_KEY in the transcriber/web app so we read the
        # right transcriptions.<key>.transcription text.
        self.transcription_key = os.environ.get("TRANSCRIPTION_KEY", "whisper")

        self.model_path = os.environ.get("FLAG_MODEL_PATH")
        if not self.model_path:
            log.error("FLAG_MODEL_PATH is required (path to a GGUF model)")
            sys.exit(1)

        self.prompt = os.environ.get("FLAG_PROMPT") or DEFAULT_PROMPT
        # Stamped onto every processed doc. Bump it (and clear flagged_meta) to
        # re-evaluate the corpus after changing the prompt.
        self.prompt_version = os.environ.get("FLAG_PROMPT_VERSION", "1")

        # Messages per model call. Small keeps each prompt short (fast on CPU,
        # in-context, high recall) and output mapping trivial.
        self.batch_size = int(os.environ.get("FLAG_BATCH_SIZE", "40"))
        # How often to check the backlog (seconds).
        self.poll_interval = int(os.environ.get("FLAG_POLL_INTERVAL", "300"))
        # Flush a partial batch once its oldest un-flagged doc is at least this
        # old, so quiet periods don't leave a handful of messages un-flagged
        # indefinitely (seconds).
        self.max_wait = int(os.environ.get("FLAG_MAX_WAIT", "1800"))

        # llama.cpp knobs. n_ctx only needs to hold one batch prompt (~1-2k
        # tokens) plus the small JSON output, so the KV cache stays cheap.
        self.n_ctx = int(os.environ.get("FLAG_N_CTX", "4096"))
        self.threads = int(os.environ.get("FLAG_THREADS", "0")) or None
        self.max_tokens = int(os.environ.get("FLAG_MAX_TOKENS", "512"))

        self.model_name = Path(self.model_path).name


class Flagger:
    def __init__(self, config):
        self.config = config
        self._stop = False

        if not Path(config.model_path).exists():
            log.error("FLAG_MODEL_PATH does not exist: %s", config.model_path)
            sys.exit(1)

        client = pymongo.MongoClient(config.mongo_uri)
        self.collection = client[config.mongo_db][config.mongo_collection]

        self._text_field = f"transcriptions.{config.transcription_key}.transcription"

    # -- lifecycle ---------------------------------------------------------

    def run(self):
        signal.signal(signal.SIGTERM, self._handle_signal)
        signal.signal(signal.SIGINT, self._handle_signal)
        log.info(
            "Flagger started: model=%s batch_size=%d poll=%ds max_wait=%ds",
            self.config.model_name, self.config.batch_size,
            self.config.poll_interval, self.config.max_wait,
        )
        while not self._stop:
            try:
                self._poll_once()
            except Exception:  # noqa: BLE001 - never let one bad cycle kill the loop
                log.exception("Poll cycle failed")
            self._sleep(self.config.poll_interval)
        log.info("Shutting down")

    def _handle_signal(self, signum, _frame):
        log.info("Received signal %s, stopping", signum)
        self._stop = True

    def _sleep(self, seconds):
        # Interruptible sleep so SIGTERM doesn't wait out a full poll interval.
        deadline = time.monotonic() + seconds
        while not self._stop and time.monotonic() < deadline:
            time.sleep(min(1.0, deadline - time.monotonic()))

    # -- polling / draining -----------------------------------------------

    def _pending_cursor(self, limit):
        return (
            self.collection.find(
                {
                    self._text_field: {"$exists": True, "$ne": ""},
                    "flagged_meta": {"$exists": False},
                },
                {"_id": 1, "date": 1, self._text_field: 1},
            )
            .sort("date", pymongo.ASCENDING)
            .limit(limit)
        )

    def _poll_once(self):
        # One cheap look at the head of the backlog decides readiness: a full
        # batch is ready immediately; a partial batch waits until its oldest
        # message has aged past max_wait.
        head = list(self._pending_cursor(self.config.batch_size))
        if not head:
            return
        ready = len(head) >= self.config.batch_size or (
            self._age_seconds(head[0].get("date")) >= self.config.max_wait
        )
        if not ready:
            log.debug("Backlog of %d not yet ready to flag", len(head))
            return
        self._drain()

    def _drain(self):
        # Ready to process: load the model once, then drain the whole pending
        # backlog in batches (cheaper than paying reload cost for the tail), and
        # release the model so idle RAM drops back to ~nothing.
        log.info("Loading model %s", self.config.model_name)
        llm = self._load_model()
        total = 0
        try:
            while not self._stop:
                batch = list(self._pending_cursor(self.config.batch_size))
                if not batch:
                    break
                self._flag_batch(llm, batch)
                total += len(batch)
                if len(batch) < self.config.batch_size:
                    break  # drained the tail
        finally:
            self._release_model(llm)
        log.info("Flagged pass complete: %d transcriptions processed", total)

    # -- inference --------------------------------------------------------

    def _load_model(self):
        # Imported lazily so the module imports without llama_cpp present (e.g.
        # for tests) and the load cost is only paid when there's work.
        from llama_cpp import Llama

        return Llama(
            model_path=self.config.model_path,
            n_ctx=self.config.n_ctx,
            n_threads=self.config.threads,
            verbose=False,
        )

    def _release_model(self, llm):
        try:
            llm.close()
        except Exception:  # noqa: BLE001 - best-effort; del + gc frees the rest
            pass
        del llm
        gc.collect()

    def _flag_batch(self, llm, batch):
        prompt = self._build_user_prompt(batch)
        now = datetime.now(timezone.utc)
        try:
            flagged = self._run_model(llm, prompt, len(batch))
            error = False
        except Exception:  # noqa: BLE001 - a bad response shouldn't wedge the loop
            log.exception("Model call/parse failed for a batch of %d", len(batch))
            flagged = {}
            error = True

        base_meta = {
            "model": self.config.model_name,
            "prompt_version": self.config.prompt_version,
            "date": now,
        }
        if error:
            base_meta["error"] = True

        ops = []
        for pos, doc in enumerate(batch, start=1):
            update = {"flagged_meta": base_meta}
            if pos in flagged:
                update["interesting"] = True
                update["interesting_reason"] = flagged[pos]
            ops.append(UpdateOne({"_id": doc["_id"]}, {"$set": update}))
        if ops:
            self.collection.bulk_write(ops, ordered=False)
        log.info(
            "Batch of %d: %d flagged interesting%s",
            len(batch), len(flagged), " (parse error)" if error else "",
        )

    def _build_user_prompt(self, batch):
        lines = []
        for pos, doc in enumerate(batch, start=1):
            text = self._doc_text(doc).replace("\n", " ").strip()
            lines.append(f"{pos}. {text}")
        return (
            "Here are numbered radio transmission transcriptions:\n\n"
            + "\n".join(lines)
            + "\n\nList ONLY the interesting ones by their number, each with a "
            "reason of at most 15 words. If none are interesting, return an "
            "empty list."
        )

    def _run_model(self, llm, user_prompt, batch_len):
        out = llm.create_chat_completion(
            messages=[
                # FLAG_PROMPT is the entire system prompt (see DEFAULT_PROMPT).
                {"role": "system", "content": self.config.prompt},
                {"role": "user", "content": user_prompt},
            ],
            response_format={"type": "json_object", "schema": RESPONSE_SCHEMA},
            temperature=0.0,
            max_tokens=self.config.max_tokens,
        )
        content = out["choices"][0]["message"]["content"]
        data = json.loads(content)

        flagged = {}
        for entry in data.get("interesting", []):
            try:
                idx = int(entry["index"])
            except (KeyError, TypeError, ValueError):
                continue
            if 1 <= idx <= batch_len:
                reason = str(entry.get("reason", "")).strip()[:REASON_MAX_LEN]
                flagged[idx] = reason
        return flagged

    # -- helpers ----------------------------------------------------------

    def _doc_text(self, doc):
        return (
            doc.get("transcriptions", {})
            .get(self.config.transcription_key, {})
            .get("transcription", "")
        )

    def _age_seconds(self, dt):
        if dt is None:
            return 0
        # pymongo returns naive UTC datetimes by default; make comparison safe
        # whether or not the client was configured tz-aware.
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - dt).total_seconds()


if __name__ == "__main__":
    Flagger(Config()).run()
