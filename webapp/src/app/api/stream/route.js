// Proxies the internal Icecast live stream through the web app's own origin.
// Keeping it same-origin means Icecast stays a ClusterIP-only service (no
// ingress) and the browser's Web Audio AnalyserNode can read the audio for the
// spectrogram without CORS taint. Mirrors the /api/audio file proxy.

// Never cache a live stream, and force the route to be dynamic.
export const dynamic = 'force-dynamic'

const STREAM_URL = process.env.STREAM_URL

export async function GET() {
  if (!STREAM_URL) {
    // Live streaming is optional (icecast.enabled=false / dev without an SDR).
    return new Response('Live stream not configured', { status: 503 })
  }

  let upstream
  try {
    upstream = await fetch(STREAM_URL, { cache: 'no-store' })
  } catch {
    return new Response('Bad gateway', { status: 502 })
  }
  if (!upstream.ok || !upstream.body) {
    return new Response('Bad gateway', { status: 502 })
  }

  // upstream.body is a ReadableStream, so Next pipes the MP3 through chunk by
  // chunk rather than buffering the (endless) stream.
  return new Response(upstream.body, {
    headers: {
      'Content-Type': upstream.headers.get('content-type') || 'audio/mpeg',
      'Cache-Control': 'no-store',
    },
  })
}
