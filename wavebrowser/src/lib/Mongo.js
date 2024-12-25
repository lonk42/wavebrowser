import { MongoClient, ServerApiVersion } from 'mongodb'

if (!process.env.MONGODB_URI) {
  throw new Error('Invalid/Missing environment variable: "MONGODB_URI"')
}

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const uri = process.env.MONGODB_URI
const options = { serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true }}
let client
let clientPromise

// In development mode, use a global variable so that the value is preserved across module reloads caused by HMR
if (process.env.NODE_ENV === 'development') {    
    let globalWithMongo = MongoClient

    if (!globalWithMongo._mongoClientPromise) {
        client = new MongoClient(uri, options)
        globalWithMongo._mongoClientPromise = client.connect()
    }
    clientPromise = globalWithMongo._mongoClientPromise

// In production mode, it's best to not use a global variable.
} else {
    client = new MongoClient(uri, options)
    clientPromise = client.connect()
}

// Export a module-scoped MongoClient promise. By doing this in a separate module, the client can be shared across functions.
export default clientPromise