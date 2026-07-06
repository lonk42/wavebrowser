"use client";
import { useMemo } from "react";
import { usePlayer } from "@/context/PlayerContext";

const BINS = 96; // 15-minute buckets across 24h
const secOfDay = (d) => {
  const x = new Date(d);
  return x.getHours() * 3600 + x.getMinutes() * 60 + x.getSeconds();
};

// A 24-hour activity histogram. Bar height shows how many recordings fall in
// each bucket (so clusters stand out); clicking anywhere jumps the list to that
// time via onPick(fraction 0..1).
export default function DayTimeline({ items, visibleRange, onPick }) {
  const { current } = usePlayer();

  const { counts, starCounts, max } = useMemo(() => {
    const counts = new Array(BINS).fill(0);
    const starCounts = new Array(BINS).fill(0);
    for (const it of items) {
      const bin = Math.min(BINS - 1, Math.floor((secOfDay(it.date) / 86400) * BINS));
      counts[bin]++;
      if (it.bookmarked) starCounts[bin]++;
    }
    return { counts, starCounts, max: Math.max(1, ...counts) };
  }, [items]);

  const activeFrac = current ? secOfDay(current.date) / 86400 : null;

  const handleClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    onPick(frac);
  };

  return (
    <div className="select-none">
      <div
        onClick={handleClick}
        className="group relative h-12 cursor-pointer rounded-lg border border-line bg-surface/60 px-1"
        title="Click to jump to a time"
      >
        {/* baseline */}
        <div className="pointer-events-none absolute inset-x-1 bottom-1 h-px bg-line" />

        {/* currently-visible window — the span of the day the list is scrolled to */}
        {visibleRange && (
          <div
            className="pointer-events-none absolute inset-y-1 rounded-sm border-x border-signal/50 bg-signal/10"
            style={{
              left: `${visibleRange[0] * 100}%`,
              width: `${Math.max(0.6, (visibleRange[1] - visibleRange[0]) * 100)}%`,
            }}
          />
        )}

        {/* hour gridlines */}
        {[6, 12, 18].map((h) => (
          <div
            key={h}
            className="pointer-events-none absolute bottom-1 top-1 w-px bg-line/60"
            style={{ left: `${(h / 24) * 100}%` }}
          />
        ))}

        {/* histogram bars */}
        <div className="pointer-events-none absolute inset-x-1 bottom-1 top-1 flex items-end gap-px">
          {counts.map((c, i) => (
            <div
              key={i}
              className="relative flex-1 overflow-hidden rounded-sm transition-colors"
              style={{
                height: c ? `${Math.max(12, (c / max) * 100)}%` : "2px",
                backgroundColor: c ? "var(--color-signal)" : "var(--color-line)",
                opacity: c ? 0.55 + 0.45 * (c / max) : 1,
              }}
            >
              {/* Bookmarked share of this bucket, filled gold from the baseline */}
              {starCounts[i] > 0 && (
                <div
                  className="absolute inset-x-0 bottom-0"
                  style={{
                    height: `${(starCounts[i] / c) * 100}%`,
                    backgroundColor: "var(--color-star)",
                  }}
                />
              )}
            </div>
          ))}
        </div>

        {/* now-playing position */}
        {activeFrac !== null && (
          <div
            className="pointer-events-none absolute bottom-0 top-0 w-0.5 -translate-x-1/2 bg-signal shadow-[0_0_8px_var(--color-signal)]"
            style={{ left: `${activeFrac * 100}%` }}
          />
        )}
      </div>

      {/* hour axis */}
      <div className="mt-1 flex justify-between px-0.5 font-mono text-[0.6rem] tracking-tight text-faint">
        <span>00:00</span>
        <span>06:00</span>
        <span>12:00</span>
        <span>18:00</span>
        <span>24:00</span>
      </div>
    </div>
  );
}
