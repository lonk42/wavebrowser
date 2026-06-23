"use client";
import { Radio, RadioTower, ArrowDownToLine } from "lucide-react";
import DayPager from "./DayPager";
import SearchBar from "./SearchBar";
import DayTimeline from "./DayTimeline";
import LivePlayer from "./LivePlayer";

export default function AppHeader({
  date,
  onDateChange,
  query,
  onQueryChange,
  freqs,
  activeFreq,
  onFreqChange,
  count,
  items,
  visibleRange,
  onPickTime,
  liveOpen,
  onToggleLive,
  autoscroll,
  onToggleAutoscroll,
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/80 backdrop-blur-xl">
      {/* glow */}
      <div className="signal-glow pointer-events-none absolute inset-x-0 top-0 h-32" />

      <div className="relative mx-auto max-w-5xl px-4 pb-4 pt-5 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-lg border border-signal/30 bg-signal-soft text-signal">
              <Radio className="size-5" strokeWidth={2} />
            </span>
            <div>
              <h1 className="font-display text-xl font-extrabold leading-none tracking-tight text-fg">
                WAVE<span className="text-signal">BROWSER</span>
              </h1>
              <p className="mt-1 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-faint">
                {count} {count === 1 ? "transmission" : "transmissions"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onToggleAutoscroll}
              aria-pressed={autoscroll}
              title="Keep the newest transmissions in view"
              className={`flex items-center gap-1.5 rounded-md border px-2.5 py-2 font-mono text-[0.65rem] uppercase tracking-[0.15em] transition-colors ${
                autoscroll
                  ? "border-signal/40 bg-signal-soft text-signal"
                  : "border-line text-muted hover:border-signal/40 hover:text-signal"
              }`}
            >
              <ArrowDownToLine className="size-4" />
              Auto
            </button>
            <button
              onClick={onToggleLive}
              aria-pressed={liveOpen}
              className={`flex items-center gap-1.5 rounded-md border px-2.5 py-2 font-mono text-[0.65rem] uppercase tracking-[0.15em] transition-colors ${
                liveOpen
                  ? "border-signal/40 bg-signal-soft text-signal"
                  : "border-line text-muted hover:border-signal/40 hover:text-signal"
              }`}
            >
              <RadioTower className="size-4" />
              Live
            </button>
            <DayPager date={date} onChange={onDateChange} />
          </div>
        </div>

        {liveOpen && (
          <div className="mt-4">
            <LivePlayer />
          </div>
        )}

        <div className="mt-4">
          <SearchBar
            query={query}
            onQueryChange={onQueryChange}
            freqs={freqs}
            activeFreq={activeFreq}
            onFreqChange={onFreqChange}
          />
        </div>

        {items.length > 0 && (
          <div className="mt-4">
            <DayTimeline items={items} visibleRange={visibleRange} onPick={onPickTime} />
          </div>
        )}
      </div>
    </header>
  );
}
