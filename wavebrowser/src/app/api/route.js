import connect from '@/lib/Mongo'

export async function GET(request) {
  const client = await connect
  const cursor = await client.db("transcriber").collection("transcriptions").find(({ "transcriptions.openai_whisper": { "$exists": true } }));
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
