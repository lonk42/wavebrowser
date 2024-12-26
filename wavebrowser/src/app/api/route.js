import connect from '@/lib/Mongo'

export async function GET(request) {
  const client = await connect

  // Capture the 'date' GET parameter
  const url = new URL(request.url)
  const dateParam = url.searchParams.get('date')
  let searchDate = new Date() // Default to 'today'

  // If we were given a search date, mangle it into the correct format
  if (dateParam) {
    searchDate = new Date(`${dateParam.substring(0, 4)}-${dateParam.substring(4, 6)}-${dateParam.substring(6, 8)}`)
  }

  // Data in mongo is UTC, we need to convert from our localtime
  const searchDateUTC = new Date(searchDate.getTime() + (searchDate.getTimezoneOffset() * 60000));

  // Figure out what the 'nextDay' is for filtering
  const nextDayUTC = new Date(searchDateUTC)
  nextDayUTC.setUTCDate(nextDayUTC.getUTCDate() + 1)

  // Get the data from mongo and return it
  const cursor = await client
    .db("transcriber")
    .collection("transcriptions")
    .find({
      "transcriptions.openai_whisper": { "$exists": true },
      "transcriptions.openai_whisper.transcription": { "$ne": "" },
      date: { $gte: searchDateUTC, $lt: nextDayUTC }
    })
    .sort({ date: 1 })

  const transcriptions = await cursor.toArray()
  return Response.json(transcriptions)
}

/** We will need this later
export async function POST(request){
  const client = await connect;
  const cursor = await client.db("transcriber").collection("transcriptions").insertOne();
  return Response.json({message: "successfully updated the document"})
}
**/
