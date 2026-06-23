import { NextResponse } from "next/server";
import { COOKIE_NAME, gateConfig, gateToken } from "@/lib/gate";

// Enforces the color-password gate. Runs before page.js mounts, so an un-passed
// visitor never triggers the day fetch (/api) or the SSE stream (/api/events).
export async function middleware(req) {
  const cfg = gateConfig();
  if (!cfg.enabled) return NextResponse.next();

  const { pathname } = req.nextUrl;
  const expected = await gateToken(cfg.color, cfg.secret);
  const passed = req.cookies.get(COOKIE_NAME)?.value === expected && !!expected;

  // The gate page and its validation endpoint must stay reachable while locked.
  const onGate = pathname === "/gate" || pathname.startsWith("/api/gate");

  if (passed) {
    // A passed visitor has no reason to see the gate again.
    if (pathname === "/gate") {
      return NextResponse.redirect(new URL("/", req.url));
    }
    return NextResponse.next();
  }

  if (onGate) return NextResponse.next();

  return NextResponse.redirect(new URL("/gate", req.url));
}

// Skip Next internals and static assets; everything else flows through the gate.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
