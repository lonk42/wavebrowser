// Toggles the shared `bookmarked` flag on a single recording document. There are
// no user accounts, so a bookmark is a global property of the recording: this
// just sets/unsets a top-level boolean, keyed by _id. The transcriber only ever
// writes $setOnInsert base fields + $set on transcriptions.<key>, so this field
// is safe from being clobbered.

import getClientPromise from '@/lib/Mongo'
import { ObjectId } from 'mongodb'

export const dynamic = 'force-dynamic'

const MONGODB_DB = process.env.MONGODB_DB || 'transcriber'

export async function POST(req) {
  let body
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  const id = body?.id
  const bookmarked = !!body?.bookmarked

  if (typeof id !== 'string' || !/^[a-f0-9]{24}$/.test(id)) {
    return Response.json({ ok: false, error: 'invalid id' }, { status: 400 })
  }

  const client = await getClientPromise()
  const res = await client
    .db(MONGODB_DB)
    .collection('transcriptions')
    .updateOne(
      { _id: new ObjectId(id) },
      bookmarked ? { $set: { bookmarked: true } } : { $unset: { bookmarked: '' } }
    )

  if (res.matchedCount === 0) {
    return Response.json({ ok: false, error: 'not found' }, { status: 404 })
  }

  return Response.json({ ok: true, bookmarked })
}
