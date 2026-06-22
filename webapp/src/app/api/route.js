import connect from '@/lib/Mongo'

// The engine key transcriptions are stored under (transcriptions.<key>).
// Matches TRANSCRIPTION_KEY in the processor; defaults to "whisper".
const TRANSCRIPTION_KEY = process.env.TRANSCRIPTION_KEY || 'whisper'
const MONGODB_DB = process.env.MONGODB_DB || 'transcriber'

export async function GET(request) {
  const client = await connect

  // Capture the 'date' GET parameter (YYYYMMDD), defaulting to today.
  const url = new URL(request.url)
  const dateParam = url.searchParams.get('date')
  let searchDate = new Date()

  if (dateParam) {
    searchDate = new Date(`${dateParam.substring(0, 4)}-${dateParam.substring(4, 6)}-${dateParam.substring(6, 8)}`)
  }

  // Data in mongo is UTC; convert the requested local day into a UTC range.
  const searchDateUTC = new Date(searchDate.getTime() + (searchDate.getTimezoneOffset() * 60000))
  const nextDayUTC = new Date(searchDateUTC)
  nextDayUTC.setUTCDate(nextDayUTC.getUTCDate() + 1)

  const textField = `transcriptions.${TRANSCRIPTION_KEY}.transcription`

  const cursor = client
    .db(MONGODB_DB)
    .collection('transcriptions')
    .find({
      [textField]: { $exists: true, $ne: '' },
      date: { $gte: searchDateUTC, $lt: nextDayUTC },
    })
    .sort({ date: 1 })

  const docs = await cursor.toArray()

  // Normalize each document so the client is decoupled from the engine key and
  // from how audio is served.
  const results = docs.map((doc) => ({
    _id: doc._id,
    date: doc.date,
    frequency_hz: doc.frequency_hz,
    transcription: doc.transcriptions?.[TRANSCRIPTION_KEY]?.transcription ?? '',
    audioUrl: `/api/audio/${doc.rel_path}`,
  }))

  return Response.json(results)
}
