"""Downsampled waveform peaks for the web GUI's card backgrounds.

Shared by the transcriber (computes peaks at transcription time) and the
backfill tool (populates peaks for recordings transcribed before this existed).
Kept dependency-light: only numpy, which faster-whisper already pulls in.
"""

import numpy as np


def compute_peaks(samples, buckets=100):
    """Reduce a 1-D audio sample array to `buckets` normalized amplitude peaks.

    `samples` is the float32 mono array faster-whisper's decode_audio returns.
    Each bucket is the peak (max abs) amplitude over its slice of the clip,
    normalized so the loudest bucket is 1.0. Returns a plain list of floats
    rounded to 3 decimals (small enough to store inline in the Mongo doc), or
    an empty list for empty/silent audio (the web card treats [] like absent).
    """
    if samples is None:
        return []
    arr = np.abs(np.asarray(samples, dtype=np.float32))
    if arr.size == 0:
        return []
    # Split into near-equal slices and take each slice's peak. array_split
    # handles a length that isn't a clean multiple of `buckets`.
    peaks = np.array([s.max() if s.size else 0.0 for s in np.array_split(arr, buckets)])
    top = peaks.max()
    if top <= 0:
        return []
    return [round(float(p), 3) for p in peaks / top]
