"""Wavebrowser transcriber.

Watches a recordings directory for new MP3 files produced by rtlsdr-airband,
transcribes them with faster-whisper on the GPU, and stores the result in
MongoDB. Designed to coexist on a shared GPU: the model is loaded once and kept
resident, defaulting to the int8_float16 build of large-v3 for a smaller VRAM
footprint.

All configuration is via environment variables (see Config).
"""

import os
import re
import sys
import time
import queue
import signal
import logging
import threading
from pathlib import Path
from datetime import datetime, timezone

import pymongo
from faster_whisper import WhisperModel
from faster_whisper.audio import decode_audio
from watchdog.observers import Observer
from watchdog.events import PatternMatchingEventHandler

from peaks import compute_peaks

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(message)s",
)
log = logging.getLogger("transcriber")

# rtlsdr-airband filenames look like: <template>__<YYYYMMDD_HHMMSS>_<freq>.mp3
# (e.g. r2__20241214_160043_146950000.mp3). The template prefix is ignored so a
# change to filename_template in rtl_airband.conf does not break parsing.
FILENAME_RE = re.compile(r"(?P<datetime>\d{8}_\d{6})_(?P<frequency>\d+)\.mp3$")


def _env_bool(name, default):
    val = os.environ.get(name)
    if val is None:
        return default
    return val.strip().lower() in ("1", "true", "yes", "on")


class Config:
    def __init__(self):
        self.mongo_uri = os.environ.get("MONGODB_URI")
        if not self.mongo_uri:
            log.error("MONGODB_URI is required")
            sys.exit(1)
        self.mongo_db = os.environ.get("MONGODB_DB", "transcriber")
        self.mongo_collection = os.environ.get("MONGODB_COLLECTION", "transcriptions")

        self.recordings_dir = Path(os.environ.get("RECORDINGS_DIR", "/recordings"))

        # Safety-net rescan interval (seconds). The inotify watcher can silently
        # go deaf - e.g. an event-queue overflow during a startup burst leaves
        # the observer alive but delivering nothing, so new recordings pile up
        # untranscribed until the pod restarts. The sweep periodically reconciles
        # the directory against what we've processed and catches anything the
        # watcher missed. Set 0 to disable and rely on inotify alone.
        self.sweep_interval = int(os.environ.get("SWEEP_INTERVAL", "300"))

        # The sweep only needs to re-examine recently-written directories: the
        # watcher covers live writes and the startup scan covers the full
        # backlog, so steady-state reconciliation just backstops the recent
        # window where a dropped event could hide. Re-walking the entire,
        # ever-growing tree every interval is the part that does not scale.
        # Window is in seconds, compared against each directory's mtime (a write
        # bumps the containing dir's mtime). 0 scans the whole tree (legacy).
        self.sweep_window = int(os.environ.get("SWEEP_WINDOW", str(2 * 86400)))

        # _seen dedup entries are evicted once a file can no longer reappear in
        # the windowed sweep, bounding memory on a long-lived pod. The entry
        # must outlive the file's re-scannable period: a file's directory stays
        # in-window until ~a day after the file (end of its day) plus
        # SWEEP_WINDOW, so window + 2 days of margin is always safe. 0 (window
        # disabled) keeps entries for the whole process lifetime, as before.
        self.seen_ttl = self.sweep_window + 2 * 86400 if self.sweep_window else 0

        # Key the transcription is stored under in transcriptions.<key>. Kept
        # generic so the web app does not hard-code an engine name.
        self.transcription_key = os.environ.get("TRANSCRIPTION_KEY", "whisper")

        # Delete recordings that transcribe to nothing (silence/static blips) so
        # they do not accumulate on the shared volume. They produce no card
        # either way; pruning just reclaims the disk.
        self.prune_empty = _env_bool("PRUNE_EMPTY", True)

        self.whisper_model = os.environ.get("WHISPER_MODEL", "large-v3")
        self.whisper_device = os.environ.get("WHISPER_DEVICE", "cuda")
        self.whisper_compute_type = os.environ.get("WHISPER_COMPUTE_TYPE", "int8_float16")
        self.whisper_beam_size = int(os.environ.get("WHISPER_BEAM_SIZE", "5"))
        # Empty string -> let whisper auto-detect the language.
        self.whisper_language = os.environ.get("WHISPER_LANGUAGE", "en") or None
        self.whisper_initial_prompt = os.environ.get("WHISPER_INITIAL_PROMPT") or None


class RecordingProcessor:
    def __init__(self, config):
        self.config = config

        log.info(
            "Loading faster-whisper model=%s device=%s compute_type=%s",
            config.whisper_model, config.whisper_device, config.whisper_compute_type,
        )
        self.model = WhisperModel(
            config.whisper_model,
            device=config.whisper_device,
            compute_type=config.whisper_compute_type,
        )

        mongo_client = pymongo.MongoClient(config.mongo_uri)
        self.collection = mongo_client[config.mongo_db][config.mongo_collection]

        self._observer = None
        self._stop = False
        # rel_path -> monotonic timestamp it was claimed. Lets the sweep skip
        # work the watcher (or an earlier sweep) already did - including empty
        # blips that leave no MongoDB document to dedupe against. Entries age out
        # (see Config.seen_ttl) so this stays bounded on a long-lived pod.
        # Guarded because the watcher callbacks and the sweep run on different
        # threads.
        self._seen = {}
        self._seen_lock = threading.Lock()

        # Transcription runs on a single worker thread draining this queue, NOT
        # inline on the watcher's dispatch thread. faster-whisper takes hundreds
        # of ms per clip; doing that inside the inotify callback stalls the
        # observer's event reader, the kernel's fixed-size inotify queue
        # (fs.inotify.max_queued_events) overflows during any burst, and the
        # watch goes permanently deaf. Enqueueing keeps the consumer instant.
        self._queue = queue.Queue()

        # Liveness signal for the inotify observer: every delivered event bumps
        # this. The sweep reads and zeroes it each interval to decide whether the
        # observer has gone deaf and needs restarting. Separate lock so a busy
        # worker holding _seen_lock never blocks the watcher callback.
        self._watch_events = 0
        self._watch_lock = threading.Lock()
        self._restart_count = 0

    def run(self):
        """Process the existing backlog, then watch for new files forever."""
        worker = threading.Thread(
            target=self._worker, name="transcribe-worker", daemon=True
        )
        worker.start()
        self._start_watching()

        log.info("Scanning existing recordings under %s", self.config.recordings_dir)
        for path in sorted(self.config.recordings_dir.rglob("*.mp3")):
            self._enqueue(path)

        signal.signal(signal.SIGTERM, self._handle_signal)
        signal.signal(signal.SIGINT, self._handle_signal)

        log.info("Backlog queued, watching for new recordings")
        last_sweep = time.monotonic()
        while not self._stop:
            time.sleep(1)
            if self.config.sweep_interval and (
                time.monotonic() - last_sweep >= self.config.sweep_interval
            ):
                self._sweep()
                last_sweep = time.monotonic()

        if self._observer is not None:
            self._observer.stop()
            self._observer.join()
        self._queue.put(None)  # unblock the worker so it can exit
        worker.join(timeout=30)
        log.info("Shutting down")

    def _handle_signal(self, signum, _frame):
        log.info("Received signal %s, stopping", signum)
        self._stop = True

    def _start_watching(self):
        handler = PatternMatchingEventHandler(
            patterns=["*.mp3"], ignore_directories=True, case_sensitive=False
        )
        handler.on_created = self._on_created
        # Keep MongoDB in sync when a recording is removed from disk (manual
        # cleanup, retention job, or our own empty-blip pruning).
        handler.on_deleted = self._on_deleted
        observer = Observer()
        observer.schedule(handler, str(self.config.recordings_dir), recursive=True)
        observer.start()
        self._observer = observer

    def _on_created(self, event):
        self._note_watch_event()
        self._enqueue(Path(event.src_path))

    def _on_deleted(self, event):
        self._note_watch_event()
        self._safe_handle_delete(Path(event.src_path))

    def _note_watch_event(self):
        """Record that the observer delivered an event (it is still alive)."""
        with self._watch_lock:
            self._watch_events += 1

    def _restart_watcher(self):
        """Tear down and recreate a deaf observer so inotify resumes.

        Start the replacement before stopping the old one so the watch gap is
        minimal; the sweep covers anything created during the swap anyway."""
        old = self._observer
        try:
            self._start_watching()
        except Exception:
            log.exception("Failed to restart inotify observer")
            return
        if old is not None:
            try:
                old.stop()
                old.join(timeout=10)
            except Exception:
                log.exception("Error stopping the old inotify observer")
        self._restart_count += 1
        log.info("inotify observer restarted (restart #%d)", self._restart_count)

    def _enqueue(self, path):
        """Claim a file and hand it to the worker for transcription.

        Claiming (the seen-set) here, not in the worker, means a file is queued
        at most once even when the watcher and a sweep both surface it."""
        path = Path(path)
        rel_path = self._relative_path(path)
        with self._seen_lock:
            if rel_path in self._seen:
                return
            self._seen[rel_path] = time.monotonic()
        self._queue.put((path, rel_path))

    def _worker(self):
        """Drain the queue, transcribing one clip at a time off the watcher thread."""
        while True:
            item = self._queue.get()
            try:
                if item is None:  # shutdown sentinel
                    return
                path, rel_path = item
                try:
                    self.transcribe(path)
                except Exception:
                    log.exception("Transcription failed for %s", path)
                    # Unclaim so a later sweep retries a transient failure.
                    with self._seen_lock:
                        self._seen.pop(rel_path, None)
            finally:
                self._queue.task_done()

    def _scan_mp3s(self):
        """List *.mp3 files the sweep should reconcile.

        With SWEEP_WINDOW set, only files in directories whose mtime is within
        the window are returned, so the cost tracks recent activity rather than
        the whole (ever-growing) history - the watcher covers live writes and
        the startup backlog scan covers everything else. A write bumps the
        containing directory's mtime, so a file a deaf watcher missed is in a
        recent directory and still surfaces here. Window 0 scans the full tree."""
        root = self.config.recordings_dir
        if not self.config.sweep_window:
            return sorted(root.rglob("*.mp3"))
        cutoff = time.time() - self.config.sweep_window
        out = []
        for dirpath, _dirnames, filenames in os.walk(root):
            try:
                # Only collect files from recently-touched directories; we still
                # descend everywhere so recent leaves under an older parent
                # (e.g. just after a day/month rollover) are not skipped.
                if os.stat(dirpath).st_mtime < cutoff:
                    continue
            except OSError:
                continue
            for name in filenames:
                if name.lower().endswith(".mp3"):
                    out.append(Path(dirpath) / name)
        return sorted(out)

    def _evict_seen(self):
        """Drop dedup entries old enough that the file can no longer reappear in
        the windowed sweep, bounding _seen on a long-lived pod. Holds no lock of
        its own - the caller already holds _seen_lock."""
        if not self.config.seen_ttl:
            return
        cutoff = time.monotonic() - self.config.seen_ttl
        for rel_path in [k for k, ts in self._seen.items() if ts < cutoff]:
            del self._seen[rel_path]

    def _sweep(self):
        """Reconcile the recordings directory against what we've processed.

        Safety net for a silently-deaf inotify observer: any *.mp3 the watcher
        never delivered is queued here. transcribe() and the seen-map keep this
        idempotent, so already-handled files cost only a dict lookup. The sweep
        also health-checks the observer: if recordings appeared this interval
        but the watcher delivered no events, it has gone deaf (typically an
        inotify queue overflow) and is restarted so it resumes as the
        low-latency path - the sweep alone already kept ingestion correct."""
        try:
            paths = self._scan_mp3s()
        except OSError:
            log.exception("Sweep failed to scan %s", self.config.recordings_dir)
            return
        with self._seen_lock:
            missed = [p for p in paths if self._relative_path(p) not in self._seen]
            self._evict_seen()
        # Read and reset the observer's liveness counter for this interval.
        with self._watch_lock:
            events = self._watch_events
            self._watch_events = 0

        if missed:
            log.warning(
                "Sweep found %d recording(s) the watcher missed; processing", len(missed)
            )
            for path in missed:
                if self._stop:
                    break
                self._enqueue(path)

        # Files appeared but the watcher reported nothing all interval -> deaf.
        if missed and events == 0:
            log.error(
                "inotify observer is deaf (%d recording(s) missed, 0 events "
                "delivered this interval); restarting it", len(missed)
            )
            self._restart_watcher()

    def transcribe(self, path):
        path = Path(path)

        match = FILENAME_RE.search(path.name)
        if match is None:
            log.warning("Skipping '%s': filename does not match expected pattern", path.name)
            return

        file_datetime = datetime.strptime(match.group("datetime"), "%Y%m%d_%H%M%S").replace(
            tzinfo=timezone.utc
        )
        frequency_hz = match.group("frequency")
        rel_path = self._relative_path(path)

        # Skip if this file already has a transcription for our engine key.
        existing = self.collection.find_one({"rel_path": rel_path})
        if existing and existing.get("transcriptions", {}).get(self.config.transcription_key):
            log.debug("Already transcribed, skipping %s", rel_path)
            return

        log.info("Transcribing %s", rel_path)
        text, info, peaks = self._run_whisper(path)

        # Empty result (silence/blips): never creates a card. Prune the file if
        # configured, otherwise just leave it untranscribed on disk.
        if not text:
            if self.config.prune_empty:
                self._prune(path, rel_path)
            else:
                log.info("Empty transcription for %s, skipping insert", rel_path)
            return

        self.collection.update_one(
            {"rel_path": rel_path},
            {
                "$setOnInsert": {
                    "filename": path.name,
                    "rel_path": rel_path,
                    "date": file_datetime,
                    "frequency_hz": frequency_hz,
                    # Audio length in seconds, from whisper's probe of the file.
                    "duration": round(float(info.duration), 1),
                    # Downsampled waveform envelope (0..1) the web GUI draws as a
                    # faint background behind each card. Empty for silent clips.
                    "peaks": peaks,
                },
                "$set": {
                    f"transcriptions.{self.config.transcription_key}": {
                        "transcription": text,
                        "model": self.config.whisper_model,
                        "language": info.language,
                        "date": datetime.now(timezone.utc),
                    }
                },
            },
            upsert=True,
        )
        log.info("Stored transcription for %s: %r", rel_path, text)

    def _safe_handle_delete(self, path):
        try:
            self._handle_delete(path)
        except Exception:
            log.exception("Failed to handle deletion of %s", path)

    def _handle_delete(self, path):
        rel_path = self._relative_path(path)
        result = self.collection.delete_one({"rel_path": rel_path})
        if result.deleted_count:
            log.info("Removed transcription for deleted recording %s", rel_path)

    def _prune(self, path, rel_path):
        # Delete the blip file. The on_deleted watcher then drops any matching
        # document, but empty recordings normally have none.
        try:
            path.unlink(missing_ok=True)
            log.info("Pruned empty recording %s", rel_path)
        except OSError:
            log.exception("Failed to prune %s", rel_path)

    def _relative_path(self, path):
        try:
            return str(path.relative_to(self.config.recordings_dir))
        except ValueError:
            # File is outside the recordings dir (shouldn't happen) - fall back
            # to the bare filename.
            return path.name

    def _run_whisper(self, path):
        # Decode the clip once (faster-whisper's own decoder) so we can both feed
        # the samples to the model and derive the waveform peaks the web GUI draws
        # behind each card - no second decode pass.
        samples = decode_audio(str(path))
        peaks = compute_peaks(samples)
        segments, info = self.model.transcribe(
            samples,
            language=self.config.whisper_language,
            beam_size=self.config.whisper_beam_size,
            initial_prompt=self.config.whisper_initial_prompt,
            # VAD filtering removes silence/static gaps, which is the single most
            # important setting for noisy radio - it stops whisper hallucinating
            # text over dead air.
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 500},
            # Anti-hallucination tuning for adverse audio.
            condition_on_previous_text=False,
            no_speech_threshold=0.6,
            log_prob_threshold=-1.0,
            compression_ratio_threshold=2.4,
        )
        text = " ".join(segment.text.strip() for segment in segments).strip()
        return text, info, peaks


if __name__ == "__main__":
    RecordingProcessor(Config()).run()
