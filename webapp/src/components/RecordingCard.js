"use client";
import { format } from "date-fns";
import { Play, Pause } from "lucide-react";
import { usePlayer } from "@/context/PlayerContext";

const mhz = (hz) => (Number(hz) / 1e6).toFixed(3);

// Compact, subtle recording length. Sub-minute clips read as "4.2s"; longer
// ones as "1:23". Returns null when no duration was stored (older records).
const fmtDuration = (s) => {
  if (s == null || !isFinite(s)) return null;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
};

export default function RecordingCard({ item, index, isNew }) {
  const { currentId, isPlaying, playTrack } = usePlayer();
  const isActive = currentId === item._id;
  const isThisPlaying = isActive && isPlaying;
  const date = new Date(item.date);

  return (
    <button
      type="button"
      id={`rec-${item._id}`}
      onClick={() => playTrack(item)}
      // Live arrivals slide in on their own; only the initial load batch uses
      // the index-based staggered reveal.
      style={isNew ? undefined : { animationDelay: `${Math.min(index, 12) * 40}ms` }}
      className={`${
        isNew ? "animate-slide-in" : "animate-reveal"
      } group flex w-full scroll-mt-44 items-stretch gap-4 rounded-xl border p-3 text-left transition-all duration-200 sm:gap-5 sm:p-4 ${
        isActive
          ? "border-signal/40 bg-elevated shadow-[0_0_30px_-12px_var(--color-signal)]"
          : "border-line bg-surface hover:border-line-strong hover:bg-elevated"
      }`}
    >
      {/* Play / pause */}
      <span
        className={`grid size-11 shrink-0 self-center place-items-center rounded-full border transition-colors ${
          isActive
            ? "border-signal bg-signal text-bg"
            : "border-line-strong text-fg group-hover:border-signal/60 group-hover:text-signal"
        }`}
      >
        {isThisPlaying ? (
          <Pause className="size-4" fill="currentColor" />
        ) : (
          <Play className="size-4 translate-x-px" fill="currentColor" />
        )}
      </span>

      {/* Time — the primary readout */}
      <div className="flex w-[7.5rem] shrink-0 flex-col justify-center border-r border-line pr-4 sm:w-[8.5rem]">
        <span
          className={`font-mono text-2xl font-semibold tabular-nums leading-none tracking-tight ${
            isActive ? "text-signal" : "text-fg"
          }`}
        >
          {format(date, "HH:mm:ss")}
        </span>
        <span className="mt-2 font-mono text-xs tracking-tight text-muted">
          {mhz(item.frequency_hz)}
          <span className="ml-1 text-[0.6rem] uppercase tracking-[0.15em] text-faint">MHz</span>
        </span>
        {fmtDuration(item.duration) && (
          <span className="mt-1 font-mono text-[0.6rem] tracking-tight text-faint">
            {fmtDuration(item.duration)}
          </span>
        )}
      </div>

      {/* Transcription */}
      <p className="flex-1 self-center text-sm leading-relaxed text-fg/90">
        {item.transcription}
      </p>

      {/* Live equalizer */}
      {isThisPlaying && (
        <span className="flex shrink-0 items-end gap-[3px] self-center pr-1" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="eq-bar block w-[3px] rounded-full bg-signal"
              style={{ height: "16px", animationDelay: `${i * 0.18}s` }}
            />
          ))}
        </span>
      )}
    </button>
  );
}
