#!/usr/bin/env python3
"""Backfill waveform peaks for recordings transcribed before peaks existed.

The transcriber stores a downsampled waveform envelope (`peaks`) on each
document so the web GUI can draw it behind the card. Documents written before
that feature lack the field and their cards render with no background. This
one-shot walks the peakless documents, re-decodes their audio (no GPU/Whisper
needed - decode only), and sets `peaks`, so older cards gain the background too.

Reuses the same env vars as the transcriber: MONGODB_URI, MONGODB_DB,
MONGODB_COLLECTION, RECORDINGS_DIR. Documents whose audio file is gone (pruned)
are skipped. Run once, e.g. inside the processor pod:

  python3 tools/backfill_peaks.py
"""

import os
import sys
from pathlib import Path

import pymongo
from faster_whisper.audio import decode_audio

# Import the shared peaks helper from the transcriber app package.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))
from peaks import compute_peaks  # noqa: E402


def main():
    mongo_uri = os.environ.get("MONGODB_URI")
    if not mongo_uri:
        print("MONGODB_URI is required", file=sys.stderr)
        return 1
    mongo_db = os.environ.get("MONGODB_DB", "transcriber")
    mongo_collection = os.environ.get("MONGODB_COLLECTION", "transcriptions")
    recordings_dir = Path(os.environ.get("RECORDINGS_DIR", "/recordings"))

    collection = pymongo.MongoClient(mongo_uri)[mongo_db][mongo_collection]

    cursor = collection.find(
        {"peaks": {"$exists": False}}, {"_id": 1, "rel_path": 1}
    )

    updated = missing = failed = 0
    for doc in cursor:
        rel_path = doc.get("rel_path")
        if not rel_path:
            continue
        path = recordings_dir / rel_path
        if not path.exists():
            missing += 1
            continue
        try:
            peaks = compute_peaks(decode_audio(str(path)))
        except Exception as exc:  # noqa: BLE001 - one bad file shouldn't stop the run
            print(f"FAILED  {rel_path}: {exc}", file=sys.stderr)
            failed += 1
            continue
        collection.update_one({"_id": doc["_id"]}, {"$set": {"peaks": peaks}})
        updated += 1
        if updated % 100 == 0:
            print(f"  ...{updated} updated", flush=True)

    print(
        f"done: {updated} updated, {missing} skipped (audio gone), {failed} failed",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
