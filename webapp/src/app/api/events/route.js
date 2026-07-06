import getClientPromise from '@/lib/Mongo'

// Server-Sent Events stream of newly-transcribed recordings. The client opens a
// single long-lived EventSource and receives new items as they land, instead of
// re-polling the whole day. MongoDB here is standalone (no change streams), so
// the server watermark-polls the collection once a second and pushes only the
// docs written since the last tick — one shared query regardless of how many
// browsers are connected.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const TRANSCRIPTION_KEY = process.env.TRANSCRIPTION_KEY || 'whisper'
const MONGODB_DB = process.env.MONGODB_DB || 'transcriber'

const POLL_MS = 1000 // how often to look for newly-transcribed docs
const HEARTBEAT_MS = 20000 // keep the connection alive through proxies

export async function GET(request) {
  const client = await getClientPromise()
  const coll = client.db(MONGODB_DB).collection('transcriptions')
  const textField = `transcriptions.${TRANSCRIPTION_KEY}.transcription`
  const dateField = `transcriptions.${TRANSCRIPTION_KEY}.date`

  // Seed the watermark from MongoDB's own latest write timestamp rather than
  // this pod's wall clock, so the stream is immune to any clock skew between
  // the web pod and the DB. Docs that already exist at connect are the client's
  // baseline (it just loaded them via REST); we only push what's written after.
  const latest = await coll
    .find({ [dateField]: { $exists: true } })
    .sort({ [dateField]: -1 })
    .limit(1)
    .next()
  let watermark = latest?.transcriptions?.[TRANSCRIPTION_KEY]?.date ?? new Date(0)

  const encoder = new TextEncoder()
  let poll
  let beat

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false
      const send = (chunk) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          closed = true
          clearInterval(poll)
          clearInterval(beat)
        }
      }

      const tick = async () => {
        try {
          const docs = await coll
            .find({
              [textField]: { $exists: true, $ne: '' },
              [dateField]: { $gt: watermark },
            })
            .sort({ [dateField]: 1 })
            .toArray()
          if (!docs.length) return
          watermark = docs[docs.length - 1].transcriptions[TRANSCRIPTION_KEY].date
          const items = docs.map((doc) => ({
            _id: doc._id,
            date: doc.date,
            frequency_hz: doc.frequency_hz,
            duration: doc.duration ?? null,
            peaks: doc.peaks ?? null,
            bookmarked: !!doc.bookmarked,
            transcription: doc.transcriptions?.[TRANSCRIPTION_KEY]?.transcription ?? '',
            audioUrl: `/api/audio/${doc.rel_path}`,
          }))
          send(`data: ${JSON.stringify(items)}\n\n`)
        } catch {
          // Transient (e.g. Mongo blip) — the next tick retries.
        }
      }

      send('retry: 3000\n\n') // tell the browser to reconnect quickly if dropped
      await tick() // emit immediately on connect
      poll = setInterval(tick, POLL_MS)
      beat = setInterval(() => send(': ping\n\n'), HEARTBEAT_MS)

      const onAbort = () => {
        closed = true
        clearInterval(poll)
        clearInterval(beat)
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      }
      request.signal.addEventListener('abort', onAbort)
    },
    cancel() {
      clearInterval(poll)
      clearInterval(beat)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Defensive: disable proxy buffering so events flush immediately.
      'X-Accel-Buffering': 'no',
    },
  })
}
