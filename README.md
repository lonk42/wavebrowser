# Wavebrowser
A stack for recording USB-SDR based radio to file, generating transcriptions against those recordings, browsable via a web GUI.

![Transcriber Docker Image](https://img.shields.io/badge/Transcriber%20Docker%20Image-1.0.0-red)
![Helm Chart](https://img.shields.io/badge/Helm%20Chart-1.0.0-red)
![License GPL3.0](https://img.shields.io/badge/License-GPL3.0-blue.svg)

## Architecture

Three components share a single recordings volume plus a MongoDB:

- **sdr** — `rtlsdr-airband` records radio to MP3 files (config from a ConfigMap) and publishes a continuous live MP3 to the internal **icecast** server.
- **transcriber** — a Python service (faster-whisper on GPU) that watches the recordings and writes transcriptions into MongoDB.
- **web** — a Next.js app that browses the transcriptions, streams the recorded audio, and offers a **Listen Live** feed (the icecast stream proxied at `/api/stream`) with a browser-side audio spectrogram.
- **icecast** — a small internal Icecast server (ClusterIP only) that relays the sdr live stream to the web app.

## Requirements

- A Kubernetes cluster with:
  - The **NVIDIA device plugin** (the transcriber requests `nvidia.com/gpu`).
  - A **ReadWriteMany** capable StorageClass (e.g. NFS) for the recordings volume — the sdr pod writes while the transcriber and web pods read.
- A node with the USB SDR dongle attached (pin the sdr pod to it via `sdr.nodeSelector`).

## Deploy with Helm

```
git clone https://github.com/lonk42/wavebrowser.git
helm dependency build wavebrowser/helm/
helm show values wavebrowser/helm/ > values.yaml
# Edit values.yaml: set recordings.storageClassName (RWX), sdr.nodeSelector,
# transcriber.nodeSelector, mongodb.auth.rootPassword, sdr.config, and the
# image repositories/tags.
helm upgrade --namespace wavebrowser --create-namespace -i wavebrowser wavebrowser/helm/ --values values.yaml
```

MongoDB is provided by the Bitnami subchart by default. To use an existing
MongoDB, set `mongodb.enabled: false` and `externalMongodb.uri`.

The **Listen Live** feature is on by default (`icecast.enabled`). Change
`icecast.sourcePassword`/`icecast.adminPassword` from the defaults, and keep the
icecast output block in `sdr.config` in sync with `icecast.mountpoint`. Set
`icecast.enabled: false` (and remove the icecast output from `sdr.config`) to
disable it — the web app's `/api/stream` then returns 503 and the Live panel
shows as unavailable.

## Configuration

The transcriber is configured via environment variables (set under
`transcriber.env` in values):

| Variable | Default | Notes |
| --- | --- | --- |
| `WHISPER_MODEL` | `large-v3` | faster-whisper model |
| `WHISPER_DEVICE` | `cuda` | |
| `WHISPER_COMPUTE_TYPE` | `int8_float16` | `float16` (~5GB) for max accuracy, `int8` (~3GB) for smallest footprint |
| `WHISPER_LANGUAGE` | `en` | empty to auto-detect |
| `WHISPER_INITIAL_PROMPT` | _(unset)_ | optional domain phrasing hint |
| `TRANSCRIPTION_KEY` | `whisper` | document key transcriptions are stored under |
| `PRUNE_EMPTY` | `true` | delete recordings that transcribe to nothing (silence/static blips) instead of leaving them on the shared volume; set `false` to keep them |
| `MONGODB_URI` | _(from secret)_ | |

Recordings that yield an empty transcription never produce a card. With
`PRUNE_EMPTY` on (the default) they are deleted from disk so blips don't fill the
volume. The transcriber also watches for file deletions: removing a recording
from the recordings volume (manual cleanup, a retention job, or the pruning
above) drops its document from MongoDB, so it disappears from the web GUI.
