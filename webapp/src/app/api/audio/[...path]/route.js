import { readFile, stat } from 'fs/promises'
import path from 'path'

// Directory the recordings PVC is mounted at (read-only) inside the web pod.
const RECORDINGS_DIR = process.env.RECORDINGS_DIR || '/recordings'

// rtlsdr-airband's split_on_transmission MP3 output sometimes flushes the LAME
// encoder's trailing tag/ancillary bytes (literally "LAME3.100" + padding) into
// the *head* of the next file, so the file begins with ~19 bytes of non-frame
// junk before the first real MPEG frame. Web Audio's decodeAudioData (used to
// draw the waveform) scans past it, but stricter HTMLMediaElement decoders play
// such files silently or skip them — which is exactly the "animates but no
// sound / autoplay skips" bug. Trim anything before the first valid MPEG frame
// (or a leading ID3 tag) so the served stream starts on a frame boundary.
function trimToFirstFrame(buf) {
  // A real ID3v2 tag at the very start is valid — leave it in place.
  if (buf.length >= 3 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
    return buf
  }
  // Not an MP3 at all (e.g. a RIFF/WAVE file, as used by the dev seed): the
  // frame-sync scan below would false-match a 0xFFEx byte pair inside PCM data
  // and strip the real header. Only MP3s need trimming, so leave it untouched.
  if (buf.length >= 4 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) {
    return buf
  }
  // Scan for the first MPEG audio frame sync: 11 set bits (0xFF, then top 3
  // bits of the next byte set: 0xE0 mask).
  for (let i = 0; i + 1 < buf.length; i++) {
    if (buf[i] === 0xff && (buf[i + 1] & 0xe0) === 0xe0) {
      return i === 0 ? buf : buf.subarray(i)
    }
  }
  // No frame sync found — serve as-is rather than emptying the response.
  return buf
}

export async function GET(request, { params }) {
  const { path: segments } = await params

  // Resolve the requested file and make sure it stays within RECORDINGS_DIR to
  // prevent path traversal.
  const relPath = segments.map((s) => decodeURIComponent(s)).join('/')
  const filePath = path.resolve(RECORDINGS_DIR, relPath)
  const root = path.resolve(RECORDINGS_DIR)
  if (filePath !== root && !filePath.startsWith(root + path.sep)) {
    return new Response('Forbidden', { status: 403 })
  }

  let fileStat
  try {
    fileStat = await stat(filePath)
  } catch {
    return new Response('Not found', { status: 404 })
  }
  if (!fileStat.isFile()) {
    return new Response('Not found', { status: 404 })
  }

  // Recordings are short (a few KB), so reading the whole file to normalize the
  // header is cheap. Trim the leading junk before serving.
  const raw = await readFile(filePath)
  const data = trimToFirstFrame(raw)
  const total = data.length

  const baseHeaders = {
    'Content-Type': 'audio/mpeg',
    // Advertise range support so the browser can seek and so iOS Safari (which
    // refuses non-range media) will play.
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=3600',
  }

  // Honour a single byte-range request with a 206 partial response.
  const range = request.headers.get('range')
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
    if (m) {
      let start = m[1] === '' ? undefined : parseInt(m[1], 10)
      let end = m[2] === '' ? undefined : parseInt(m[2], 10)
      if (start === undefined && end !== undefined) {
        // Suffix range: last `end` bytes.
        start = Math.max(0, total - end)
        end = total - 1
      } else {
        if (start === undefined) start = 0
        if (end === undefined || end >= total) end = total - 1
      }
      if (start > end || start >= total) {
        return new Response('Range Not Satisfiable', {
          status: 416,
          headers: { 'Content-Range': `bytes */${total}`, 'Accept-Ranges': 'bytes' },
        })
      }
      const chunk = data.subarray(start, end + 1)
      return new Response(chunk, {
        status: 206,
        headers: {
          ...baseHeaders,
          'Content-Range': `bytes ${start}-${end}/${total}`,
          'Content-Length': String(chunk.length),
        },
      })
    }
  }

  return new Response(data, {
    headers: { ...baseHeaders, 'Content-Length': String(total) },
  })
}
