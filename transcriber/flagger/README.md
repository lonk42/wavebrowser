# Flagger

A CPU-only companion to the transcriber. It reads transcription **text** from the
same MongoDB collection and scores transmissions 0-9 with a small local LLM (via
`llama-cpp-python`), promoting the top few per day to an `interesting` badge. It
never touches audio, the recordings volume, or the GPU.

The webapp surfaces the result as a badge on each card and an "interesting only"
filter, mirroring how bookmarks work.

## How it works

A **daily scored batch pipeline** with a hard daily flag budget, rather than an
open-ended flag/no-flag classifier (which over-fired badly). Per complete UTC
day, oldest-first:

1. **Prefilter** (`prefilter.py`, deterministic, no model): drops ≤5-word lines,
   transcription-hallucination boilerplate, pure acknowledgement/pleasantry
   lines, and normalized duplicates. Roughly halves what the model has to score.
2. **Score, 3 passes** (`engine.py`): the kept records are scored in batches of
   `SCORE_BATCH` (comparative context + amortized system prompt), once per order
   in `PASS_ORDERS` — chronological plus two shuffles. Each item is scored by the
   **logprob expectation over digit tokens** (the probability-weighted mean digit
   at the score position), not the bare generated integer — that breaks the
   model's coarse integer ties into a smooth ranking. Output is grammar-
   constrained JSON (`{"scores": [[index, score], ...]}`) so a small model always
   parses; the echoed index is load-bearing (a bare digit array makes the model
   count instead of score).
3. **Fuse**: each record's score is the **mean** of its passes. Per-record scores
   are wildly composition-sensitive (the same record can swing from ~8 to ~0
   across orderings), so the mean-of-N order ensemble is the main quality
   mechanism, not polish.
4. **Promote**: the top `TOPN` records by fused score per day get
   `interesting: true`; every scored record keeps its fused score.

**Cadence is per UTC day.** Each `FLAG_POLL_INTERVAL` the poller looks for the
oldest complete day (any day before today UTC) with un-scored records. On first
deploy it walks all history oldest-first (the backfill), then settles into one
day per day. It runs as its **own process, not inside the transcriber** — a pass
over a day is minutes of CPU and would stall the transcriber's single worker.

**Model loaded per drain, released after.** Idle RAM is ~tens of MB; the peak
(~2.5–3 GB for a 3–4B Q4 model) exists only while a day is being scored. `mmap`
keeps the GGUF warm in the OS page cache, so reloads are a few seconds.

## MongoDB fields written

On the shared `transcriptions` doc (keyed by `_id`, like `bookmarked`):

- `interesting: true` — present only on the day's top-N (promoted) docs.
- `interesting_reason: <string>` — a short score readout (e.g.
  `"score 8.7/9 — daily top 20"`), promoted docs only.
- `flagged_meta` — the processed marker written to **every** doc evaluated (the
  dedup key that keeps the poller from re-scoring):
  - `{ model, prompt_version, date, score, passes }` on scored docs, where
    `score` is the fused mean (float 0-9) and `passes` are the per-pass scores.
  - `{ model, prompt_version, date, score: 0, prefiltered: true }` on docs the
    prefilter dropped (never scored, never promoted).
  - `error: true` marks a scored doc no pass could evaluate.

`interesting` is kept **absent unless true** (never stored as `false`), so the
webapp's `!!doc.interesting` reads stay simple — the same discipline the bookmark
write path uses.

**Re-score the corpus after changing the prompt or model:** bump
`FLAG_PROMPT_VERSION` and clear the processed marker, e.g.

```
db.transcriptions.updateMany({}, { $unset: { flagged_meta: "", interesting: "", interesting_reason: "" } })
```

The affected days reappear as un-scored and re-run.

## Configuration (environment variables)

| Var | Default | Meaning |
|---|---|---|
| `MONGODB_URI` | *(required)* | Mongo connection string. |
| `MONGODB_DB` | `transcriber` | Database name. |
| `MONGODB_COLLECTION` | `transcriptions` | Collection name. |
| `TRANSCRIPTION_KEY` | `whisper` | Must match the transcriber/web app; reads `transcriptions.<key>.transcription`. |
| `FLAG_MODEL_PATH` | *(required)* | Path to a local GGUF model file. |
| `SCORE_PROMPT` | *(built-in)* | The **entire scoring rubric** (one block). Overrides the built-in generic default wholesale. `FLAG_PROMPT` is accepted as a legacy alias. |
| `FLAG_PROMPT_VERSION` | `2` | Stamped onto `flagged_meta`; bump (and clear the marker) to re-score. |
| `SCORE_BATCH` | `12` | Records per model call. |
| `TOPN` | `20` | Daily flag budget — records promoted to `interesting` per UTC day. The recall/noise dial. |
| `PASS_ORDERS` | `0,7,13` | Order-ensemble seeds; `0` = chronological, others = shuffle seeds. Keep ≥3 orders. |
| `FLAG_POLL_INTERVAL` | `300` | Seconds between checks for a new complete un-scored day. |
| `FLAG_N_CTX` | `2048` | llama.cpp context window (one batch prompt + output). |
| `FLAG_THREADS` | `4` | CPU threads — set to **physical** cores; SMT/logical cores are markedly slower for llama.cpp decode. `0` lets llama.cpp choose. |
| `LOG_LEVEL` | `INFO` | Standard logging level. |

## Model

Default recommendation: **Qwen3-4B-Instruct-2507** Q4_K_M (~2.4 GB weights, peak
RSS ~3 GB at `n_ctx=2048`) — smaller and better on this task than the older 7B/8B
options. Set `FLAG_MODEL_PATH` to the GGUF; the Helm chart mounts it from a PVC.
The digit-logit fast path uses internal `llama_cpp` API, so the
`llama-cpp-python` version is pinned in `requirements.flagger.txt`.

## Running locally

```
MONGODB_URI=mongodb://localhost:27017 \
FLAG_MODEL_PATH=/path/to/model.gguf \
FLAG_POLL_INTERVAL=10 \
python3 main.py
```

Only days *before* today UTC are scored, so seed a DB with dated docs from a past
day to exercise it.

## Performance expectation

Honest planning number: **~40–50% of what a human would hand-pick, at 20
flags/day**, with the very top of the list excellent. `TOPN` is the recall/noise
dial — raising it buys recall at the cost of more marginal flags. The badge is a
"taste" signal, not a recall-complete alarm.

## Performance note

`flagged_meta: { $exists: false }` is not indexed by default. At homelab scale
(tens of thousands of docs) this is fine; for a very large collection add an index
to keep the per-poll query cheap, e.g. a partial/compound index on `date`
filtered to un-scored docs.
