// Returns every bookmarked recording across all days, newest-first. Same
// normalized item shape as the day route (/api) so RecordingCard and the player
// consume it unchanged.

import getClientPromise from '@/lib/Mongo'

export const dynamic = 'force-dynamic'

const TRANSCRIPTION_KEY = process.env.TRANSCRIPTION_KEY || 'whisper'
const MONGODB_DB = process.env.MONGODB_DB || 'transcriber'

export async function GET() {
  const client = await getClientPromise()
  const textField = `transcriptions.${TRANSCRIPTION_KEY}.transcription`

  const docs = await client
    .db(MONGODB_DB)
    .collection('transcriptions')
    .find({
      bookmarked: true,
      [textField]: { $exists: true, $ne: '' },
    })
    .sort({ date: -1 })
    .toArray()

  const results = docs.map((doc) => ({
    _id: doc._id,
    date: doc.date,
    frequency_hz: doc.frequency_hz,
    duration: doc.duration ?? null,
    peaks: doc.peaks ?? null,
    bookmarked: true,
    interesting: !!doc.interesting,
    interesting_reason: doc.interesting_reason ?? null,
    transcription: doc.transcriptions?.[TRANSCRIPTION_KEY]?.transcription ?? '',
    audioUrl: `/api/audio/${doc.rel_path}`,
  }))

  return Response.json(results)
}
