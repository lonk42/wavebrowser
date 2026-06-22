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
import signal
import logging
from pathlib import Path
from datetime import datetime, timezone

import pymongo
from faster_whisper import WhisperModel
from watchdog.observers import Observer
from watchdog.events import PatternMatchingEventHandler

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(message)s",
)
log = logging.getLogger("transcriber")

# rtlsdr-airband filenames look like: <template>__<YYYYMMDD_HHMMSS>_<freq>.mp3
# (e.g. r2__20241214_160043_146950000.mp3). The template prefix is ignored so a
# change to filename_template in rtl_airband.conf does not break parsing.
FILENAME_RE = re.compile(r"(?P<datetime>\d{8}_\d{6})_(?P<frequency>\d+)\.mp3$")


class Config:
    def __init__(self):
        self.mongo_uri = os.environ.get("MONGODB_URI")
        if not self.mongo_uri:
            log.error("MONGODB_URI is required")
            sys.exit(1)
        self.mongo_db = os.environ.get("MONGODB_DB", "transcriber")
        self.mongo_collection = os.environ.get("MONGODB_COLLECTION", "transcriptions")

        self.recordings_dir = Path(os.environ.get("RECORDINGS_DIR", "/recordings"))

        # Key the transcription is stored under in transcriptions.<key>. Kept
        # generic so the web app does not hard-code an engine name.
        self.transcription_key = os.environ.get("TRANSCRIPTION_KEY", "whisper")

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

    def run(self):
        """Process the existing backlog, then watch for new files forever."""
        self._start_watching()

        log.info("Scanning existing recordings under %s", self.config.recordings_dir)
        for path in sorted(self.config.recordings_dir.rglob("*.mp3")):
            self._safe_transcribe(path)

        signal.signal(signal.SIGTERM, self._handle_signal)
        signal.signal(signal.SIGINT, self._handle_signal)

        log.info("Backlog complete, watching for new recordings")
        while not self._stop:
            time.sleep(1)

        if self._observer is not None:
            self._observer.stop()
            self._observer.join()
        log.info("Shutting down")

    def _handle_signal(self, signum, _frame):
        log.info("Received signal %s, stopping", signum)
        self._stop = True

    def _start_watching(self):
        handler = PatternMatchingEventHandler(
            patterns=["*.mp3"], ignore_directories=True, case_sensitive=False
        )
        handler.on_created = lambda event: self._safe_transcribe(Path(event.src_path))
        self._observer = Observer()
        self._observer.schedule(handler, str(self.config.recordings_dir), recursive=True)
        self._observer.start()

    def _safe_transcribe(self, path):
        try:
            self.transcribe(path)
        except Exception:
            log.exception("Transcription failed for %s", path)

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
        text, info = self._run_whisper(path)

        # Skip empty results (silence/blips) so they do not create dead cards.
        if not text:
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

    def _relative_path(self, path):
        try:
            return str(path.relative_to(self.config.recordings_dir))
        except ValueError:
            # File is outside the recordings dir (shouldn't happen) - fall back
            # to the bare filename.
            return path.name

    def _run_whisper(self, path):
        segments, info = self.model.transcribe(
            str(path),
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
        return text, info


if __name__ == "__main__":
    RecordingProcessor(Config()).run()
