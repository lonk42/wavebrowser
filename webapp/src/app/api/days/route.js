import getClientPromise from '@/lib/Mongo'

// Which calendar days have any (non-empty) transcription — powers the calendar
// day-picker so the user can jump straight back to a day that actually has data.
//
// Days are bucketed in the *client's* timezone (passed as `tz`, an IANA name),
// consistent with the rest of the app: `date` is stored UTC, but the user sees
// and selects local days. MongoDB's $dateToString takes an IANA timezone and
// handles DST per-date, so a transmission near local midnight lands on the day
// the user would expect. Falls back to UTC if `tz` is missing/invalid.
const TRANSCRIPTION_KEY = process.env.TRANSCRIPTION_KEY || 'whisper'
const MONGODB_DB = process.env.MONGODB_DB || 'transcriber'

async function aggregateDays(client, tz) {
  const textField = `transcriptions.${TRANSCRIPTION_KEY}.transcription`
  return client
    .db(MONGODB_DB)
    .collection('transcriptions')
    .aggregate([
      { $match: { [textField]: { $exists: true, $ne: '' } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$date', timezone: tz } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ])
    .toArray()
}

export async function GET(request) {
  const client = await getClientPromise()
  const tz = new URL(request.url).searchParams.get('tz') || 'UTC'

  let rows
  try {
    rows = await aggregateDays(client, tz)
  } catch {
    // Invalid timezone string (or a Mongo without tz data) — fall back to UTC
    // rather than 500 the picker.
    rows = await aggregateDays(client, 'UTC')
  }

  return Response.json(rows.map((r) => ({ day: r._id, count: r.count })))
}
