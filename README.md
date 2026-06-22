# Wavebrowser
A stack for recording USB-SDR based radio to file, generating transcriptions against those recordings, browsable via a web GUI.

![Transcriber Docker Image](https://img.shields.io/badge/Transcriber%20Docker%20Image-0.0.1-red)
![Helm Chart](https://img.shields.io/badge/Helm%20Chart-0.0.1-red)
![License GPL3.0](https://img.shields.io/badge/License-GPL3.0-blue.svg)

## Architecture

Three components share a single recordings volume plus a MongoDB:

- **sdr** — `rtlsdr-airband` records radio to MP3 files (config from a ConfigMap).
- **transcriber** — a Python service (faster-whisper on GPU) that watches the recordings and writes transcriptions into MongoDB.
- **web** — a Next.js app that browses the transcriptions and streams the audio.

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

## Building images

Both images are published to `ghcr.io`:

- `ghcr.io/lonk42/wavebrowser-processor` (built from `transcriber/`)
- `ghcr.io/lonk42/wavebrowser-web` (built from `webapp/`)

### Via CI (GitHub Actions)

Pushing a release tag builds and pushes both images automatically
(`.github/workflows/publish-image.yml`). The tag becomes the image version:

```
git tag v0.1.0 && git push origin v0.1.0
# -> wavebrowser-processor:{0.1.0,0.1,latest} and wavebrowser-web:{...}
```

### Manually

```
docker build -t ghcr.io/lonk42/wavebrowser-processor:<tag> transcriber/
docker build -t ghcr.io/lonk42/wavebrowser-web:<tag> webapp/
```

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
| `MONGODB_URI` | _(from secret)_ | |

### TODO
* Post-process recordings to prune tiny/blip files (currently empty transcriptions are skipped, so they exist on disk but produce no card)
* Add a delete handler so removed recordings drop out of MongoDB
