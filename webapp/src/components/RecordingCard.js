"use client";
import { format } from "date-fns";
import { Play, Pause } from "lucide-react";
import { usePlayer } from "@/context/PlayerContext";

const mhz = (hz) => (Number(hz) / 1e6).toFixed(3);

export default function RecordingCard({ item, index }) {
  const { currentId, isPlaying, playTrack } = usePlayer();
  const isActive = currentId === item._id;
  const isThisPlaying = isActive && isPlaying;
  const date = new Date(item.date);

  return (
    <button
      type="button"
      id={`rec-${item._id}`}
      onClick={() => playTrack(item)}
      style={{ animationDelay: `${Math.min(index, 12) * 40}ms` }}
      className={`animate-reveal group flex w-full scroll-mt-44 items-stretch gap-4 rounded-xl border p-3 text-left transition-all duration-200 sm:gap-5 sm:p-4 ${
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
      <div className="flex w-[6.5rem] shrink-0 flex-col justify-center border-r border-line pr-4 sm:w-28">
        <div className="flex items-baseline font-mono tabular-nums leading-none">
          <span
            className={`text-3xl font-semibold tracking-tight ${
              isActive ? "text-signal" : "text-fg"
            }`}
          >
            {format(date, "HH:mm")}
          </span>
          <span className="ml-0.5 text-base text-muted">:{format(date, "ss")}</span>
        </div>
        <span className="mt-2 font-mono text-xs tracking-tight text-muted">
          {mhz(item.frequency_hz)}
          <span className="ml-1 text-[0.6rem] uppercase tracking-[0.15em] text-faint">MHz</span>
        </span>
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
