// Validates a submitted hex color against the configured secret, server-side.
// The correct color never leaves this process; on a match we set an httpOnly
// cookie holding a SHA-256 token (not the color) that the middleware checks.

import { NextResponse } from "next/server";
import {
  COOKIE_NAME,
  COOKIE_MAX_AGE,
  gateConfig,
  gateToken,
  normalizeHex,
} from "@/lib/gate";

export const dynamic = "force-dynamic";

export async function POST(req) {
  const cfg = gateConfig();

  // Defensive: if the gate is off, there's nothing to pass.
  if (!cfg.enabled) {
    return NextResponse.json({ ok: true });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const guess = normalizeHex(body?.hex);
  const answer = normalizeHex(cfg.color);

  if (!guess || guess !== answer) {
    // No hint about the answer.
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const token = await gateToken(cfg.color, cfg.secret);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
  return res;
}
