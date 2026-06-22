import { readFile, stat } from 'fs/promises'
import path from 'path'

// Directory the recordings PVC is mounted at (read-only) inside the web pod.
const RECORDINGS_DIR = process.env.RECORDINGS_DIR || '/recordings'

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

  const data = await readFile(filePath)
  return new Response(data, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Content-Length': String(fileStat.size),
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
