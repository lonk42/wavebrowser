// Shared helpers for the color-password gate. Written to run in BOTH the edge
// middleware and the node route handler, so it only uses web-standard globals
// (crypto.subtle, TextEncoder) and process.env.
//
// The correct color lives in server env only. The proof cookie stores a
// SHA-256 token of the color (optionally salted with PASSWORD_GATE_SECRET), not
// the color itself, so the answer never reaches the client and the cookie can't
// be forged without solving the puzzle.

export const COOKIE_NAME = "wb_gate";

// One year — the gate is "new visitors only", so a pass should stick.
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

// Lowercased 6-digit hex without the leading "#", expanding 3-digit shorthand.
// Returns null when the input is not a valid hex color.
export function normalizeHex(input) {
  if (typeof input !== "string") return null;
  const s = input.trim();
  if (!HEX_RE.test(s)) return null;
  let hex = s.replace(/^#/, "").toLowerCase();
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((c) => c + c)
      .join("");
  }
  return hex;
}

// SHA-256 hex of the normalized color (+ optional secret). Async because
// crypto.subtle.digest is async in both runtimes. Returns null for bad input.
export async function gateToken(color, secret = "") {
  const norm = normalizeHex(color);
  if (!norm) return null;
  const data = new TextEncoder().encode(`${secret}:${norm}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Reads the gate configuration from server env, with defaults.
export function gateConfig() {
  return {
    enabled: process.env.PASSWORD_GATE_ENABLED === "true",
    message:
      process.env.PASSWORD_GATE_MESSAGE ||
      "Tune to the right frequency — match the signal color to enter.",
    color: process.env.PASSWORD_GATE_COLOR || "#bef24a",
    secret: process.env.PASSWORD_GATE_SECRET || "",
  };
}
