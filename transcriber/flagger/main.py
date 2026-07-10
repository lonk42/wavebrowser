"""Wavebrowser interesting-message flagger (daily scored pipeline).

A CPU-only companion to the transcriber. It reads transcription *text* from the
same MongoDB collection (never audio, never the GPU, never the recordings
volume) and scores transmissions 0-9 with a small local LLM, promoting the top
few per day to `interesting: true` — a hard daily flag budget rather than an
open-ended flag/no-flag classifier.

Cadence is per UTC day. Each poll it finds the oldest *complete* UTC day (any day
before today) that still has un-scored transmissions and scores the whole day:

  prefilter (deterministic, drops ~half)         [prefilter.py]
    -> 3 scoring passes in different orders        [engine.py Engine]
       (chronological + two shuffles) — batches of SCORE_BATCH, each item scored
       by logprob expectation over digit tokens, not the bare integer
    -> per-record score = mean of the passes
    -> top-TOPN by fused score get interesting=true; every record gets a score

Per-record scores are wildly composition-sensitive, so the mean-of-N order
ensemble is the main quality mechanism, not polish. On first deploy the poller
walks all history oldest-first (the backfill), then settles into one day per day.

It runs as its own process, NOT inside the transcriber: a llama.cpp pass over a
day is minutes of CPU and would stall the transcriber's single worker. The model
is loaded once per drain and released after, so idle RAM drops back to ~nothing.

All configuration is via environment variables (see Config).
"""

import gc
import os
import sys
import time
import random
import signal
import logging
from pathlib import Path
from datetime import datetime, timedelta, timezone

import pymongo
from pymongo import UpdateOne

# Run as `python3 main.py`; make sibling modules importable regardless of cwd.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from prefilter import prefilter_docs  # noqa: E402

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(message)s",
)
log = logging.getLogger("flagger")

# Default scoring rubric — the model's full instructions. SCORE_PROMPT overrides
# this and is the ENTIRE system prompt (one block), not a fragment. Kept
# deliberately generic and domain-neutral; tune the real rubric to your feed and
# inject it via SCORE_PROMPT (e.g. Helm values), never in the repo.
DEFAULT_PROMPT = (
    'You are curating a "most interesting moments" badge for short radio '
    "transmission transcriptions. Only a tiny fraction of traffic deserves the "
    "badge — most transmissions are routine and must score low. Score each "
    "transmission from 0 to 9.\n"
    "\n"
    "Score high (7-9): genuinely funny, absurd, or deadpan exchanges; vivid, "
    "novel, or bizarre incidents; a moment with real human character. Score the "
    "event, not the wording.\n"
    "Score mid (4-6): a real incident with an odd or human touch, but nothing "
    "remarkable.\n"
    "Score low (0-3): routine check-ins, callsigns, tests, acknowledgements, "
    "status updates, and ordinary procedural chatter with no memorable detail.\n"
    "\n"
    "CRITICAL — garbled: if the text is so garbled, fragmentary, or "
    "mis-transcribed that you cannot tell what actually happened, score 0-1 no "
    "matter how dramatic the fragments sound.\n"
    "CRITICAL — routine: if it is ordinary operational or procedural traffic, "
    "score 0-1 no matter how urgent or busy it sounds.\n"
    "\n"
    "Be harsh and use the full range. Most items should score in the low band."
)


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

        # SCORE_PROMPT is the whole scoring rubric. FLAG_PROMPT is accepted as a
        # legacy alias so older deployments keep working.
        self.prompt = (
            os.environ.get("SCORE_PROMPT")
            or os.environ.get("FLAG_PROMPT")
            or DEFAULT_PROMPT
        )
        # Stamped onto every processed doc. Bump it (and clear flagged_meta +
        # interesting/interesting_reason) to re-score the corpus after changing
        # the prompt or model.
        self.prompt_version = os.environ.get("FLAG_PROMPT_VERSION", "2")

        # Items per model call. Small keeps each prompt short and gives the model
        # comparative context (routine chatter beside the odd line) to calibrate.
        self.score_batch = int(os.environ.get("SCORE_BATCH", "12"))
        # The daily flag budget: the top-N fused scores per UTC day get promoted.
        self.topn = int(os.environ.get("TOPN", "20"))
        # Order ensemble: score the day once per seed and average. 0 = keep
        # chronological order; non-zero = shuffle with that seed. Mean-of-N is
        # the main quality mechanism, so keep at least 3 orders.
        self.pass_orders = self._parse_orders(os.environ.get("PASS_ORDERS", "0,7,13"))

        # How often to look for a new complete un-scored day (seconds).
        self.poll_interval = int(os.environ.get("FLAG_POLL_INTERVAL", "300"))

        # llama.cpp knobs. n_ctx holds one batch prompt (rubric + ~12 items,
        # ~1-2k tokens) plus the small JSON output. Threads should be PHYSICAL
        # cores — SMT/logical cores measured markedly slower for llama.cpp decode.
        self.n_ctx = int(os.environ.get("FLAG_N_CTX", "2048"))
        self.threads = int(os.environ.get("FLAG_THREADS", "4")) or None

        self.model_name = Path(self.model_path).name

    @staticmethod
    def _parse_orders(raw):
        orders = []
        for part in raw.split(","):
            part = part.strip()
            if part:
                orders.append(int(part))
        return orders or [0]


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
            "Flagger started: model=%s batch=%d topn=%d passes=%s poll=%ds",
            self.config.model_name, self.config.score_batch, self.config.topn,
            self.config.pass_orders, self.config.poll_interval,
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

    # -- scheduling / draining --------------------------------------------

    def _next_unscored_day(self):
        """(day_start, day_end) UTC of the oldest complete day with un-scored
        transmissions, or None. A day before today UTC is by definition complete."""
        today_start = datetime.now(timezone.utc).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        doc = self.collection.find_one(
            {
                self._text_field: {"$exists": True, "$ne": ""},
                "flagged_meta": {"$exists": False},
                "date": {"$lt": today_start},
            },
            {"date": 1},
            sort=[("date", pymongo.ASCENDING)],
        )
        if not doc:
            return None
        d = doc["date"]
        if d.tzinfo is None:
            d = d.replace(tzinfo=timezone.utc)
        day_start = d.replace(hour=0, minute=0, second=0, microsecond=0)
        return day_start, day_start + timedelta(days=1)

    def _poll_once(self):
        if self._next_unscored_day() is None:
            return
        self._drain()

    def _drain(self):
        # Load the model once, then score every complete un-scored day
        # oldest-first (amortizes model load across a backfill), and release it.
        log.info("Loading model %s", self.config.model_name)
        engine = self._load_engine()
        total = 0
        try:
            while not self._stop:
                span = self._next_unscored_day()
                if not span:
                    break
                day_start, day_end = span
                n = self._process_day(engine, day_start, day_end)
                total += n
                log.info("UTC day %s scored: %d records", day_start.date(), n)
        finally:
            self._release_engine(engine)
        log.info("Drain complete: %d records processed", total)

    # -- scoring ----------------------------------------------------------

    def _load_engine(self):
        # Imported lazily so the module imports without llama_cpp present (e.g.
        # for tests) and the load cost is only paid when there's work.
        from engine import Engine

        return Engine(self.config.model_path, self.config.threads, self.config.n_ctx)

    def _release_engine(self, engine):
        engine.close()
        del engine
        gc.collect()

    def _process_day(self, engine, day_start, day_end):
        docs = list(self._day_cursor(day_start, day_end))
        if not docs:
            return 0

        kept, dropped = prefilter_docs(docs, self._doc_text)
        now = datetime.now(timezone.utc)

        # Score the kept docs once per order and collect the per-doc scores.
        scores = {doc["_id"]: [] for doc in kept}
        for seed in self.config.pass_orders:
            if self._stop:
                break
            ordered = list(kept)
            if seed:
                random.Random(seed).shuffle(ordered)
            self._score_pass(engine, ordered, scores)

        # Fuse (mean of the passes) and rank; the top-N get promoted.
        fused = {
            _id: (sum(vals) / len(vals) if vals else 0.0)
            for _id, vals in scores.items()
        }
        ranked = sorted(fused, key=fused.get, reverse=True)
        topn = set(ranked[: self.config.topn])

        base = {
            "model": self.config.model_name,
            "prompt_version": self.config.prompt_version,
            "date": now,
        }
        ops = []
        for doc in kept:
            _id = doc["_id"]
            meta = dict(base)
            meta["score"] = round(fused[_id], 4)
            meta["passes"] = [round(v, 4) for v in scores[_id]]
            if not scores[_id]:
                meta["error"] = True
            update = {"flagged_meta": meta}
            if _id in topn and scores[_id]:
                update["interesting"] = True
                update["interesting_reason"] = (
                    f"score {fused[_id]:.1f}/9 — daily top {self.config.topn}"
                )
            ops.append(UpdateOne({"_id": _id}, {"$set": update}))
        for doc in dropped:
            meta = dict(base)
            meta["score"] = 0
            meta["prefiltered"] = True
            ops.append(UpdateOne({"_id": doc["_id"]}, {"$set": {"flagged_meta": meta}}))

        if ops:
            self.collection.bulk_write(ops, ordered=False)
        log.info(
            "Day %s: %d kept, %d prefiltered, %d promoted",
            day_start.date(), len(kept), len(dropped), min(len(topn), len(kept)),
        )
        return len(docs)

    def _score_pass(self, engine, ordered_docs, scores):
        batch = self.config.score_batch
        for start in range(0, len(ordered_docs), batch):
            if self._stop:
                break
            batch_docs = ordered_docs[start:start + batch]
            texts = [self._doc_text(d) for d in batch_docs]
            try:
                entries = engine.score_batch(self.config.prompt, texts)
            except Exception:  # noqa: BLE001 - a bad batch shouldn't wedge the day
                log.exception("Scoring batch of %d failed", len(batch_docs))
                continue
            for bidx, sc in entries.items():
                scores[batch_docs[bidx]["_id"]].append(sc)

    # -- helpers ----------------------------------------------------------

    def _day_cursor(self, day_start, day_end):
        return (
            self.collection.find(
                {
                    self._text_field: {"$exists": True, "$ne": ""},
                    "flagged_meta": {"$exists": False},
                    "date": {"$gte": day_start, "$lt": day_end},
                },
                {"_id": 1, "date": 1, self._text_field: 1},
            )
            .sort("date", pymongo.ASCENDING)
        )

    def _doc_text(self, doc):
        return (
            doc.get("transcriptions", {})
            .get(self.config.transcription_key, {})
            .get("transcription", "")
        )


if __name__ == "__main__":
    Flagger(Config()).run()
