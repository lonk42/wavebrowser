"use client";
import { format } from "date-fns";
import Link from "next/link";
import { Play, Pause, Star, CalendarArrowUp, Sparkles, ThumbsUp, ThumbsDown } from "lucide-react";
import { usePlayer } from "@/context/PlayerContext";
import CardWaveform from "@/components/CardWaveform";

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

export default function RecordingCard({
  item,
  index,
  isNew,
  flashId,
  onToggleBookmark,
  onSetFeedback,
  jumpHref,
}) {
  const { currentId, isPlaying, playTrack } = usePlayer();
  const isActive = currentId === item._id;
  const isThisPlaying = isActive && isPlaying;
  const bookmarked = !!item.bookmarked;
  const interesting = !!item.interesting;
  // Human thumbs verdict on the flag — "up" | "down" | null. Clicking the active
  // one again clears it. Captured as training data; shown on flagged cards only.
  const feedback = item.flag_feedback ?? null;
  const date = new Date(item.date);

  // Border: active glow wins, then a user-bookmarked card reads gold, then an
  // LLM-flagged "interesting" card reads green, else the default idle border.
  const borderClass = isActive
    ? "border-signal/40 bg-elevated shadow-[0_0_30px_-12px_var(--color-signal)]"
    : bookmarked
    ? "border-star/60 bg-surface hover:border-star hover:bg-elevated"
    : interesting
    ? "border-ai/50 bg-surface hover:border-ai hover:bg-elevated"
    : "border-line bg-surface hover:border-line-strong hover:bg-elevated";

  return (
    // Root is a plain element (not a button) so the star/jump controls can be
    // real buttons/links without nesting interactive elements. The id +
    // scroll-mt live here so timeline jump-to-card still targets it.
    <div
      id={`rec-${item._id}`}
      className={`group relative isolate scroll-mt-44${
        flashId === item._id ? " animate-focus-flash" : ""
      }`}
    >
      <button
        type="button"
        onClick={() => playTrack(item)}
        // Live arrivals slide in on their own; only the initial load batch uses
        // the index-based staggered reveal.
        style={isNew ? undefined : { animationDelay: `${Math.min(index, 12) * 40}ms` }}
        className={`${
          isNew ? "animate-slide-in" : "animate-reveal"
        } flex w-full items-stretch gap-4 overflow-hidden rounded-xl border p-3 text-left transition-all duration-200 sm:gap-5 sm:p-4 ${borderClass}`}
      >
        {/* Faint full-bleed waveform behind the card content. Brighter on the
            active/playing card; renders nothing for docs without stored peaks. */}
        <span
          className={`-z-10 transition-colors duration-200 ${
            isActive ? "text-signal opacity-20" : "text-muted opacity-[0.10]"
          }`}
        >
          <CardWaveform peaks={item.peaks} />
        </span>

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

        {/* Transcription — pad the right edge so the corner controls never sit
            on top of the text. */}
        <p className="flex-1 self-center pr-16 text-sm leading-relaxed text-fg/90">
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

      {/* Corner controls, stacked into a column. Top row: thumbs feedback
          (flagged cards only) + jump-to-dashboard (bookmarks/flagged pages only)
          + star toggle. The AI flag badge sits on its own row directly beneath
          the star. Siblings of the play button, not nested inside it. */}
      <div className="absolute right-2.5 top-2.5 flex flex-col items-end gap-1">
        <div className="flex items-center gap-1">
          {interesting && (
            <>
              <button
                type="button"
                onClick={() => onSetFeedback?.(item._id, feedback === "up" ? null : "up")}
                aria-pressed={feedback === "up"}
                title={feedback === "up" ? "Clear feedback" : "Good flag — thumbs up"}
                className={`grid size-8 place-items-center rounded-md border transition-colors ${
                  feedback === "up"
                    ? "border-up/50 bg-up-soft text-up"
                    : "border-line text-muted hover:border-up/50 hover:text-up"
                }`}
              >
                <ThumbsUp className="size-4" fill={feedback === "up" ? "currentColor" : "none"} />
              </button>
              <button
                type="button"
                onClick={() => onSetFeedback?.(item._id, feedback === "down" ? null : "down")}
                aria-pressed={feedback === "down"}
                title={feedback === "down" ? "Clear feedback" : "Not interesting — thumbs down"}
                className={`grid size-8 place-items-center rounded-md border transition-colors ${
                  feedback === "down"
                    ? "border-down/50 bg-down-soft text-down"
                    : "border-line text-muted hover:border-down/50 hover:text-down"
                }`}
              >
                <ThumbsDown className="size-4" fill={feedback === "down" ? "currentColor" : "none"} />
              </button>
            </>
          )}
          {jumpHref && (
            <Link
              href={jumpHref}
              title="Open on the dashboard at this day & time"
              className="grid size-8 place-items-center rounded-md border border-line text-muted transition-colors hover:border-signal/50 hover:text-signal"
            >
              <CalendarArrowUp className="size-4" />
            </Link>
          )}
          <button
            type="button"
            onClick={() => onToggleBookmark?.(item._id, !bookmarked)}
            aria-pressed={bookmarked}
            title={bookmarked ? "Remove bookmark" : "Bookmark this transmission"}
            className={`grid size-8 place-items-center rounded-md border transition-colors ${
              bookmarked
                ? "border-star/50 bg-star-soft text-star"
                : "border-line text-muted hover:border-star/50 hover:text-star"
            }`}
          >
            <Star className="size-4" fill={bookmarked ? "currentColor" : "none"} />
          </button>
        </div>
        {interesting && (
          <span
            title={item.interesting_reason || "Flagged as interesting"}
            className="flex h-8 items-center gap-1 rounded-md border border-ai/50 bg-ai-soft px-2 font-mono text-[0.65rem] font-semibold uppercase tracking-wider text-ai"
          >
            <Sparkles className="size-3.5" aria-label="Flagged as interesting" /> AI
          </span>
        )}
      </div>
    </div>
  );
}
