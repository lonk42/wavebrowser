// Sets the shared human feedback on a single recording, keyed by _id. Thumbs
// up/down is a global taste signal on the LLM flag ("was this worth flagging?"),
// collected across every card so it also captures items the model missed. It is
// intentionally decoupled from the flagger's own writes and destined for future
// training data. There are no user accounts, so like `bookmarked` this is a
// top-level property of the recording, not per-user.
//
// The transcriber only writes $setOnInsert base fields + $set on
// transcriptions.<key>, and the flagger only writes flagged_meta/interesting, so
// this field is safe from being clobbered.

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
  // "up" / "down" set the verdict; null (or anything else) clears it.
  const feedback = body?.feedback === 'up' || body?.feedback === 'down' ? body.feedback : null

  if (typeof id !== 'string' || !/^[a-f0-9]{24}$/.test(id)) {
    return Response.json({ ok: false, error: 'invalid id' }, { status: 400 })
  }

  const client = await getClientPromise()
  const res = await client
    .db(MONGODB_DB)
    .collection('transcriptions')
    .updateOne(
      { _id: new ObjectId(id) },
      feedback
        ? { $set: { flag_feedback: feedback, flag_feedback_date: new Date() } }
        : { $unset: { flag_feedback: '', flag_feedback_date: '' } }
    )

  if (res.matchedCount === 0) {
    return Response.json({ ok: false, error: 'not found' }, { status: 404 })
  }

  return Response.json({ ok: true, feedback })
}
