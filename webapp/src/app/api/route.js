import getClientPromise from '@/lib/Mongo'

// The engine key transcriptions are stored under (transcriptions.<key>).
// Matches TRANSCRIPTION_KEY in the processor; defaults to "whisper".
const TRANSCRIPTION_KEY = process.env.TRANSCRIPTION_KEY || 'whisper'
const MONGODB_DB = process.env.MONGODB_DB || 'transcriber'

export async function GET(request) {
  const client = await getClientPromise()

  const url = new URL(request.url)

  // Data in mongo is stored UTC. The client (which knows the user's timezone)
  // sends the start/end of the requested *local* day as explicit UTC instants
  // (ISO strings), so the range is correct regardless of where the browser or
  // this server is. We must NOT derive the range from a YYYYMMDD here using the
  // server's timezone — the server runs in UTC, so a non-UTC user's local day
  // would be filed under the wrong calendar day.
  const startParam = url.searchParams.get('start')
  const endParam = url.searchParams.get('end')

  let rangeStart = startParam ? new Date(startParam) : null
  let rangeEnd = endParam ? new Date(endParam) : null

  if (!rangeStart || !rangeEnd || isNaN(rangeStart) || isNaN(rangeEnd)) {
    // Fallback for direct/legacy callers: treat the 'date' param (YYYYMMDD), or
    // today, as a whole UTC calendar day.
    const dateParam = url.searchParams.get('date')
    const base = dateParam
      ? new Date(Date.UTC(+dateParam.slice(0, 4), +dateParam.slice(4, 6) - 1, +dateParam.slice(6, 8)))
      : new Date()
    rangeStart = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()))
    rangeEnd = new Date(rangeStart)
    rangeEnd.setUTCDate(rangeEnd.getUTCDate() + 1)
  }

  const textField = `transcriptions.${TRANSCRIPTION_KEY}.transcription`

  const cursor = client
    .db(MONGODB_DB)
    .collection('transcriptions')
    .find({
      [textField]: { $exists: true, $ne: '' },
      date: { $gte: rangeStart, $lt: rangeEnd },
    })
    .sort({ date: 1 })

  const docs = await cursor.toArray()

  // Normalize each document so the client is decoupled from the engine key and
  // from how audio is served.
  const results = docs.map((doc) => ({
    _id: doc._id,
    date: doc.date,
    frequency_hz: doc.frequency_hz,
    duration: doc.duration ?? null,
    transcription: doc.transcriptions?.[TRANSCRIPTION_KEY]?.transcription ?? '',
    audioUrl: `/api/audio/${doc.rel_path}`,
  }))

  return Response.json(results)
}
