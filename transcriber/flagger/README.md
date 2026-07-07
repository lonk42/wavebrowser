# Flagger

A CPU-only companion to the transcriber. It reads transcription **text** from the
same MongoDB collection and asks a small local LLM (via `llama-cpp-python`) to flag
the transmissions worth a human's attention against a configurable prompt. It never
touches audio, the recordings volume, or the GPU.

The webapp surfaces the result as a badge + reason on each card and an "interesting
only" filter, mirroring how bookmarks work.

## How it works

- **Message-rate cadence, not time-of-day.** The poller reacts to the transcriber's
  writes: each `FLAG_POLL_INTERVAL` it inspects the un-flagged backlog and processes
  it once a full batch (`FLAG_BATCH_SIZE`) has accumulated **or** the oldest
  un-flagged message has waited past `FLAG_MAX_WAIT`. Busy periods form full batches;
  quiet periods still get flushed.
- **Runs as its own process, not inside the transcriber.** A llama.cpp call is
  seconds per batch and would stall the transcriber's single worker thread — the same
  reason whisper isn't run inline in the inotify callback.
- **Model loaded per drain, released after.** Idle RAM is ~tens of MB; the ~2.5–3 GB
  peak (for a 3B Q4 model) exists only while a batch is being flagged. `mmap` keeps
  the GGUF warm in the OS page cache, so reloads are a few seconds.
- **Grammar-constrained output.** The model is constrained to a JSON schema, so even
  a small model always returns something parseable. It lists only the interesting
  items by their 1-based number in the batch; anything omitted is treated as not
  interesting.

## MongoDB fields written

On the shared `transcriptions` doc (keyed by `_id`, like `bookmarked`):

- `interesting: true` — present only on flagged docs.
- `interesting_reason: <string>` — the LLM's short justification, flagged docs only.
- `flagged_meta: { model, prompt_version, date, error? }` — processed marker written
  to **every** doc evaluated; it's the dedup key that keeps the poller from
  re-scanning the same docs. `error: true` marks a batch whose model response
  failed to parse.

`interesting` is kept **absent unless true** (never stored as `false`), so the
webapp's `!!doc.interesting` reads and the "interesting only" filter stay simple —
the same discipline the bookmark write path uses.

**Re-flag the corpus after changing the prompt:** clear the processed marker, e.g.

```
db.transcriptions.updateMany({}, { $unset: { flagged_meta: "", interesting: "", interesting_reason: "" } })
```

## Configuration (environment variables)

| Var | Default | Meaning |
|---|---|---|
| `MONGODB_URI` | *(required)* | Mongo connection string. |
| `MONGODB_DB` | `transcriber` | Database name. |
| `MONGODB_COLLECTION` | `transcriptions` | Collection name. |
| `TRANSCRIPTION_KEY` | `whisper` | Must match the transcriber/web app; reads `transcriptions.<key>.transcription`. |
| `FLAG_MODEL_PATH` | *(required)* | Path to a local GGUF model file. |
| `FLAG_PROMPT` | *(built-in)* | The **entire system prompt** (one block) — the model's instructions for what counts as interesting. Overrides the built-in default wholesale, not appended to it. |
| `FLAG_PROMPT_VERSION` | `1` | Stamped onto `flagged_meta`; bump when you change the prompt. |
| `FLAG_BATCH_SIZE` | `40` | Messages per model call. |
| `FLAG_POLL_INTERVAL` | `300` | Seconds between backlog checks. |
| `FLAG_MAX_WAIT` | `1800` | Flush a partial batch once its oldest message is this old (s). |
| `FLAG_N_CTX` | `4096` | llama.cpp context window (one batch prompt + output). |
| `FLAG_THREADS` | *(auto)* | CPU threads; `0`/unset lets llama.cpp choose. |
| `FLAG_MAX_TOKENS` | `512` | Output token cap (the output is a small JSON list). |
| `LOG_LEVEL` | `INFO` | Standard logging level. |

## Model

Default recommendation: **Qwen2.5-3B-Instruct** Q4_K_M (~2GB, ~2.5–3 GB peak RSS at
`n_ctx=4096`). **Qwen2.5-1.5B-Instruct** Q4_K_M (~1.5–2 GB peak) is a lighter option.
Set `FLAG_MODEL_PATH` to the GGUF; the Helm chart mounts it from a PVC.

## Running locally

```
MONGODB_URI=mongodb://localhost:27017 \
FLAG_MODEL_PATH=/path/to/model.gguf \
FLAG_MAX_WAIT=0 \
python3 main.py
```

`FLAG_MAX_WAIT=0` flushes immediately, handy for testing against a seeded DB.

## Performance note

`flagged_meta: { $exists: false }` is not indexed by default. At homelab scale
(tens of thousands of docs) this is fine; for a very large collection add an index
to keep the per-poll query cheap, e.g. a partial index on `date` filtered to
un-flagged docs.
