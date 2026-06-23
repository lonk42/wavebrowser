"use client";

import { useEffect, useRef, useState } from "react";
import { Radio, Lock, ArrowRight, LoaderCircle } from "lucide-react";

/* ── color math ──────────────────────────────────────────────────────────
   HSV is the picker's source of truth (it survives achromatic edits without
   the hue collapsing). RGB / hex are derived; edits to them convert back. */

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const toHex = (n) => n.toString(16).padStart(2, "0");

function hsvToRgb(h, s, v) {
  const c = v * s;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0,
    g = 0,
    b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = v - c;
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

function rgbToHsv(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

const rgbToHex = ({ r, g, b }) => `#${toHex(r)}${toHex(g)}${toHex(b)}`;

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  const int = parseInt(h, 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

/* ── component ───────────────────────────────────────────────────────────── */

export default function ColorGate({ message }) {
  // Start somewhere neutral-ish — never the answer.
  const [hsv, setHsv] = useState({ h: 205, s: 0.45, v: 0.55 });
  const [hexDraft, setHexDraft] = useState("");
  const [hexFocused, setHexFocused] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [wrong, setWrong] = useState(false);
  const [attempts, setAttempts] = useState(0);

  const rgb = hsvToRgb(hsv.h, hsv.s, hsv.v);
  const hex = rgbToHex(rgb);

  // Mirror the canonical color into the hex field, but NOT while the user is
  // typing in it — otherwise a valid intermediate value (e.g. the 3-digit
  // shorthand "bef") would be rewritten to its expanded form ("bbeeff")
  // mid-keystroke. On blur the field re-syncs to the normalized hex.
  useEffect(() => {
    if (!hexFocused) setHexDraft(hex);
  }, [hex, hexFocused]);

  const setFromRgb = (next) =>
    setHsv((prev) => {
      const h = rgbToHsv(next.r, next.g, next.b);
      if (h.s === 0 || h.v === 0) h.h = prev.h; // preserve hue when gray/black
      return h;
    });

  const onHexChange = (val) => {
    setHexDraft(val);
    const parsed = hexToRgb(val);
    if (parsed) setFromRgb(parsed);
  };

  /* dragging on the saturation / value field */
  const fieldRef = useRef(null);
  const dragging = useRef(false);

  const fieldMove = (e) => {
    const rect = fieldRef.current?.getBoundingClientRect();
    if (!rect) return;
    const s = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    const v = 1 - clamp((e.clientY - rect.top) / rect.height, 0, 1);
    setHsv((prev) => ({ ...prev, s, v }));
  };
  const fieldDown = (e) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    fieldMove(e);
  };
  const fieldPointerMove = (e) => {
    if (dragging.current) fieldMove(e);
  };
  const fieldUp = () => {
    dragging.current = false;
  };

  async function submit(e) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setWrong(false);
    try {
      const res = await fetch("/api/gate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hex }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.ok) {
        window.location.assign("/");
        return;
      }
      setWrong(true);
      setAttempts((n) => n + 1);
    } catch {
      setWrong(true);
      setAttempts((n) => n + 1);
    } finally {
      setSubmitting(false);
    }
  }

  const hueColor = `hsl(${hsv.h}, 100%, 50%)`;

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10">
      {/* atmosphere */}
      <div className="signal-glow pointer-events-none absolute inset-x-0 top-0 h-[60vh]" />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.4]"
        style={{
          background:
            "radial-gradient(120% 80% at 50% -10%, var(--color-signal-soft) 0%, transparent 55%)",
        }}
      />

      <form
        onSubmit={submit}
        key={attempts}
        className={`animate-reveal relative w-full max-w-md rounded-2xl border border-line bg-surface/90 p-6 shadow-[0_30px_120px_-40px_rgba(0,0,0,0.9)] backdrop-blur-sm sm:p-7 ${
          wrong ? "animate-shake" : ""
        }`}
        onAnimationEnd={() => setWrong(false)}
      >
        {/* corner ticks */}
        <Ticks />

        {/* eyebrow */}
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.3em] text-faint">
          <Lock className="size-3.5 text-signal" strokeWidth={2.5} />
          Locked
          <span className="ml-auto inline-flex items-center gap-1.5 text-signal">
            <Radio className="size-3.5 animate-pulse-signal" strokeWidth={2.5} />
            ARMED
          </span>
        </div>

        {/* prompt */}
        <h1 className="mt-4 font-display text-2xl font-extrabold leading-tight tracking-tight text-fg sm:text-[1.7rem]">
          {message}
        </h1>

        {/* saturation / value field */}
        <div
          ref={fieldRef}
          onPointerDown={fieldDown}
          onPointerMove={fieldPointerMove}
          onPointerUp={fieldUp}
          onPointerCancel={fieldUp}
          className="relative mt-5 h-44 w-full cursor-crosshair touch-none overflow-hidden rounded-xl border border-line-strong"
          style={{
            background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), ${hueColor}`,
          }}
        >
          <span
            className="pointer-events-none absolute size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1.5px_rgba(0,0,0,0.5),0_2px_8px_rgba(0,0,0,0.6)]"
            style={{
              left: `${hsv.s * 100}%`,
              top: `${(1 - hsv.v) * 100}%`,
              background: hex,
            }}
          />
        </div>

        {/* hue band */}
        <HueSlider
          hue={hsv.h}
          onChange={(h) => setHsv((prev) => ({ ...prev, h }))}
        />

        {/* output swatch */}
        <div className="mt-4 flex items-center gap-3">
          <div
            className="h-12 flex-1 rounded-xl border border-line-strong shadow-inner"
            style={{ background: hex }}
          />
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-faint">
            Output
          </span>
        </div>

        {/* hex input */}
        <label className="mt-5 block">
          <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-faint">
            Hex
          </span>
          <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-line bg-bg px-3 py-2 focus-within:border-signal/50">
            <span className="font-mono text-base text-faint">#</span>
            <input
              value={hexDraft.replace(/^#/, "")}
              onChange={(e) => onHexChange("#" + e.target.value)}
              onFocus={() => setHexFocused(true)}
              onBlur={() => setHexFocused(false)}
              spellCheck={false}
              autoComplete="off"
              maxLength={6}
              className="w-full bg-transparent font-mono text-base uppercase tracking-[0.15em] text-fg outline-none placeholder:text-faint"
              placeholder="rrggbb"
            />
          </div>
        </label>

        {/* status line */}
        <div className="mt-3 h-4 font-mono text-[11px] uppercase tracking-[0.2em]">
          {wrong ? (
            <span className="text-[#ff6b6b]">
              ✕ Off-frequency — no lock{attempts > 1 ? ` · ${attempts} tries` : ""}
            </span>
          ) : (
            <span className="text-faint">Awaiting lock…</span>
          )}
        </div>

        {/* submit */}
        <button
          type="submit"
          disabled={submitting}
          className="group mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-signal px-4 py-3 font-mono text-sm font-semibold uppercase tracking-[0.2em] text-[#0a0b0e] transition hover:brightness-110 disabled:opacity-60"
        >
          {submitting ? (
            <LoaderCircle className="size-4 animate-spin" strokeWidth={2.5} />
          ) : (
            <>
              Unlock
              <ArrowRight
                className="size-4 transition-transform group-hover:translate-x-0.5"
                strokeWidth={2.5}
              />
            </>
          )}
        </button>
      </form>
    </main>
  );
}

/* ── sub-components ──────────────────────────────────────────────────────── */

function HueSlider({ hue, onChange }) {
  const ref = useRef(null);
  const dragging = useRef(false);

  const move = (e) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const x = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    onChange(x * 360);
  };

  return (
    <div
      ref={ref}
      onPointerDown={(e) => {
        dragging.current = true;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        move(e);
      }}
      onPointerMove={(e) => dragging.current && move(e)}
      onPointerUp={() => (dragging.current = false)}
      onPointerCancel={() => (dragging.current = false)}
      className="relative mt-3 h-4 w-full cursor-pointer touch-none rounded-full border border-line-strong"
      style={{
        background:
          "linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)",
      }}
    >
      <span
        className="pointer-events-none absolute top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.5),0_2px_6px_rgba(0,0,0,0.6)]"
        style={{ left: `${(hue / 360) * 100}%`, background: `hsl(${hue},100%,50%)` }}
      />
    </div>
  );
}

function Ticks() {
  const base =
    "pointer-events-none absolute size-3 border-signal/40";
  return (
    <>
      <span className={`${base} left-2 top-2 border-l border-t`} />
      <span className={`${base} right-2 top-2 border-r border-t`} />
      <span className={`${base} bottom-2 left-2 border-b border-l`} />
      <span className={`${base} bottom-2 right-2 border-b border-r`} />
    </>
  );
}
