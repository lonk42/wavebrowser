"""Deterministic prefilter for flagger input — drops records no model needs to see.

Rules (in order):
  1. <= 5 words                          (shortest interesting record seen is 6 words — do NOT raise this)
  2. transcription hallucination boilerplate ("thanks for watching", "subtitles by", ...)
  3. lines composed ONLY of ack/pleasantry words (<= 12 words), e.g.
     "Yeah, roger, thank you very much." — catches acks too long for rule 1
  4. exact duplicate (normalized) of an earlier kept line

Halves the number of records the model scores for free (measured ~-49% on real
days, with no interesting record lost). The scored pipeline still records every
dropped doc (with score 0) so it is never re-processed.
"""
import re

ACK_WORDS = {
    "yeah", "yes", "yep", "nah", "no", "okay", "ok", "roger", "copy", "copies",
    "that", "thank", "thanks", "you", "very", "much", "go", "ahead", "good",
    "morning", "afternoon", "evening", "night", "all", "right", "alright",
    "cheers", "bye", "goodbye", "see", "ya", "later", "mate", "sorry", "hello",
    "hi", "hey", "um", "uh", "oh", "correct", "affirmative", "received",
    "standby", "stand", "by", "will", "do", "we'll", "be", "back", "please",
    "welcome", "you're", "it's", "fine", "great", "perfect", "lovely",
    "brilliant", "sweet", "cool", "awesome", "worries", "problem", "ta", "and",
    "the", "a", "i", "is", "was", "too", "again", "now", "then", "just", "got",
    "it", "this", "are", "when", "ready",
}
HALLUC = re.compile(
    r"thanks for watching|see you (next time|in the next)|subscribe|subtitles by|www\.",
    re.I,
)


def _norm_words(t):
    return re.findall(r"[a-z']+", t.lower())


def keep(text):
    """True if this record is worth showing to the model."""
    if len(text.split()) <= 5:
        return False
    if HALLUC.search(text):
        return False
    w = _norm_words(text)
    if len(w) <= 12 and w and all(x in ACK_WORDS for x in w):
        return False
    return True


def prefilter(texts):
    """Filter + dedupe (keeps first occurrence). Preserves input order."""
    kept, seen = [], set()
    for t in texts:
        if not keep(t):
            continue
        key = " ".join(_norm_words(t))
        if key in seen:
            continue
        seen.add(key)
        kept.append(t)
    return kept


def prefilter_docs(docs, text_of):
    """Split docs into (kept, dropped) using the same rules as prefilter().

    `text_of(doc)` returns the transcription text for a doc. Order is preserved;
    dedupe keeps the first occurrence of each normalized line. Dropped docs are
    still returned so the caller can mark them processed (score 0) and never
    re-score them.
    """
    kept, dropped, seen = [], [], set()
    for doc in docs:
        text = text_of(doc)
        if not keep(text):
            dropped.append(doc)
            continue
        key = " ".join(_norm_words(text))
        if key in seen:
            dropped.append(doc)
            continue
        seen.add(key)
        kept.append(doc)
    return kept, dropped
