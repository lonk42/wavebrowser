import { MongoClient, ServerApiVersion } from 'mongodb'

// Stable API version options.
const options = { serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true } }

// Lazily create (and cache) the connection. Done on first request rather than at
// import time so that `next build` — which imports the route modules without a
// MONGODB_URI set — does not fail.
export default function getClientPromise() {
  if (!process.env.MONGODB_URI) {
    throw new Error('Invalid/Missing environment variable: "MONGODB_URI"')
  }

  // In development reuse a global so HMR module reloads don't open new clients.
  if (process.env.NODE_ENV === 'development') {
    if (!globalThis._mongoClientPromise) {
      globalThis._mongoClientPromise = new MongoClient(process.env.MONGODB_URI, options).connect()
    }
    return globalThis._mongoClientPromise
  }

  if (!getClientPromise._promise) {
    getClientPromise._promise = new MongoClient(process.env.MONGODB_URI, options).connect()
  }
  return getClientPromise._promise
}
