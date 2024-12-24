import { MongoClient, ServerApiVersion } from 'mongodb'

    
const uri = process.env.MONGODB_URI
if(!uri){
    throw new Error("environment variable MONGODB_URI is not defined");
}

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
    try {
      // Connect the client to the server (optional starting in v4.7)
      await client.connect();
      // Querying our database
      const cursor = await client.db("transcriber").collection("transcriptions").find();
      const array = await cursor.toArray()
      return array;
    } finally {
      // Ensures that the client will close when you finish/error
      await client.close();
    }
  
  }
export async function GET(request) {
    const greetings =  await run();
    return Response.json(greetings)
}
  
