"use client";
import { useState } from "react";
import { format, addDays, isToday } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import DayCalendar from "./DayCalendar";

// Prev / current-day / next navigation. "Next" is disabled on today since there
// are no future recordings. The center date opens a calendar for jumping back
// multiple days at once (with markers for which days have data).
export default function DayPager({ date, onChange }) {
  const atToday = isToday(date);
  const [calOpen, setCalOpen] = useState(false);

  return (
    <div className="relative flex items-center gap-1">
      <PagerButton label="Previous day" onClick={() => onChange(addDays(date, -1))}>
        <ChevronLeft className="size-4" strokeWidth={2.5} />
      </PagerButton>

      <button
        onClick={() => setCalOpen((o) => !o)}
        aria-label="Pick a day"
        aria-expanded={calOpen}
        className="flex min-w-[9.5rem] flex-col items-center rounded-md px-2 py-1 transition-colors hover:bg-signal-soft"
      >
        <span className="text-[0.65rem] uppercase tracking-[0.2em] text-faint">
          {format(date, "EEEE")}
        </span>
        <span className="font-mono text-sm tracking-tight text-fg">
          {format(date, "yyyy.MM.dd")}
        </span>
      </button>

      {calOpen && (
        <DayCalendar
          selected={date}
          onSelect={onChange}
          onClose={() => setCalOpen(false)}
        />
      )}

      <PagerButton
        label="Next day"
        onClick={() => onChange(addDays(date, 1))}
        disabled={atToday}
      >
        <ChevronRight className="size-4" strokeWidth={2.5} />
      </PagerButton>

      {!atToday && (
        <button
          onClick={() => onChange(new Date())}
          className="ml-1 rounded-md border border-line px-2.5 py-1 font-mono text-[0.65rem] uppercase tracking-[0.15em] text-muted transition-colors hover:border-signal/40 hover:text-signal"
        >
          Today
        </button>
      )}
    </div>
  );
}

function PagerButton({ children, label, ...props }) {
  return (
    <button
      aria-label={label}
      className="grid size-9 place-items-center rounded-md border border-line text-muted transition-colors hover:border-line-strong hover:text-fg disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-line disabled:hover:text-muted"
      {...props}
    >
      {children}
    </button>
  );
}
