"use client";
import { Search, X, Flame } from "lucide-react";

const mhz = (hz) => (Number(hz) / 1e6).toFixed(3);

export default function SearchBar({
  query,
  onQueryChange,
  freqs,
  activeFreq,
  onFreqChange,
  hasInteresting,
  interestingOnly,
  onToggleInterestingOnly,
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="group relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint transition-colors group-focus-within:text-signal" />
        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search transcriptions…"
          className="w-full rounded-lg border border-line bg-surface py-2.5 pl-10 pr-9 text-sm text-fg placeholder:text-faint outline-none transition-colors focus:border-signal/50"
        />
        {query && (
          <button
            aria-label="Clear search"
            onClick={() => onQueryChange("")}
            className="absolute right-2.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded text-faint transition-colors hover:text-fg"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {(hasInteresting || freqs.length > 1) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {hasInteresting && (
            <button
              onClick={onToggleInterestingOnly}
              aria-pressed={interestingOnly}
              title="Show only transmissions flagged as interesting"
              className={`flex items-center gap-1 rounded-md border px-2.5 py-1 font-mono text-xs tracking-tight transition-colors ${
                interestingOnly
                  ? "border-flag/50 bg-flag-soft text-flag"
                  : "border-line text-muted hover:border-flag/50 hover:text-flag"
              }`}
            >
              <Flame
                className="size-3.5"
                fill={interestingOnly ? "currentColor" : "none"}
              />
              Interesting
            </button>
          )}
          {hasInteresting && freqs.length > 1 && (
            <span className="mx-1 h-4 w-px bg-line" aria-hidden />
          )}
          {freqs.length > 1 && (
            <>
              <Chip active={activeFreq === null} onClick={() => onFreqChange(null)}>
                All
              </Chip>
              {freqs.map((f) => (
                <Chip key={f} active={activeFreq === f} onClick={() => onFreqChange(f)}>
                  {mhz(f)}
                </Chip>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Chip({ active, children, ...props }) {
  return (
    <button
      {...props}
      className={`rounded-md border px-2.5 py-1 font-mono text-xs tracking-tight transition-colors ${
        active
          ? "border-signal/50 bg-signal-soft text-signal"
          : "border-line text-muted hover:border-line-strong hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}
