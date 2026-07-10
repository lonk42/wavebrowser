"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isAfter,
  isSameDay,
  isSameMonth,
  isToday,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";

const dayKey = (d) => format(d, "yyyy-MM-dd");

// A month-grid day picker that highlights which days have recordings, so the
// user can jump back multiple days at once instead of paging one at a time.
// Days with data are fetched from /api/days (bucketed in the browser's
// timezone, matching how the dashboard selects local days).
export default function DayCalendar({ selected, onSelect, onClose }) {
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(selected));
  const [dataDays, setDataDays] = useState(() => new Set());
  const rootRef = useRef(null);

  // Fetch the set of days-with-data once when the picker opens.
  useEffect(() => {
    let cancelled = false;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    fetch(`/api/days?tz=${encodeURIComponent(tz)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((rows) => {
        if (cancelled || !Array.isArray(rows)) return;
        setDataDays(new Set(rows.map((r) => r.day)));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Close on outside click or Escape.
  useEffect(() => {
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) onClose();
    };
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const today = startOfDay(new Date());

  const weeks = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(viewMonth));
    const gridEnd = endOfWeek(endOfMonth(viewMonth));
    const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
    const rows = [];
    for (let i = 0; i < days.length; i += 7) rows.push(days.slice(i, i + 7));
    return rows;
  }, [viewMonth]);

  // Don't page past the current month (no future recordings).
  const atCurrentMonth = isSameMonth(viewMonth, today);

  return (
    <div
      ref={rootRef}
      className="absolute right-0 top-full z-40 mt-2 w-72 rounded-lg border border-line-strong bg-elevated p-3 shadow-2xl"
    >
      <div className="mb-2 flex items-center justify-between">
        <button
          aria-label="Previous month"
          onClick={() => setViewMonth((m) => addMonths(m, -1))}
          className="grid size-7 place-items-center rounded-md border border-line text-muted transition-colors hover:border-line-strong hover:text-fg"
        >
          <ChevronLeft className="size-4" strokeWidth={2.5} />
        </button>
        <span className="font-mono text-sm tracking-tight text-fg">
          {format(viewMonth, "MMMM yyyy")}
        </span>
        <button
          aria-label="Next month"
          onClick={() => setViewMonth((m) => addMonths(m, 1))}
          disabled={atCurrentMonth}
          className="grid size-7 place-items-center rounded-md border border-line text-muted transition-colors hover:border-line-strong hover:text-fg disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-line disabled:hover:text-muted"
        >
          <ChevronRight className="size-4" strokeWidth={2.5} />
        </button>
      </div>

      <div className="mb-1 grid grid-cols-7 gap-1">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div
            key={i}
            className="text-center font-mono text-[0.6rem] uppercase tracking-widest text-faint"
          >
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {weeks.flat().map((day) => {
          const inMonth = isSameMonth(day, viewMonth);
          const future = isAfter(startOfDay(day), today);
          const hasData = dataDays.has(dayKey(day));
          const isSelected = isSameDay(day, selected);
          const isCurrent = isToday(day);

          return (
            <button
              key={day.toISOString()}
              disabled={future}
              onClick={() => {
                onSelect(day);
                onClose();
              }}
              className={[
                "relative grid aspect-square place-items-center rounded-md font-mono text-xs transition-colors",
                future ? "cursor-not-allowed opacity-20" : "hover:border-line-strong",
                isSelected
                  ? "border border-signal/60 bg-signal-soft text-signal"
                  : hasData
                    ? "border border-signal/25 text-fg hover:text-signal"
                    : "border border-transparent text-muted",
                !inMonth && !isSelected ? "opacity-40" : "",
              ].join(" ")}
              title={hasData ? "Has recordings" : undefined}
            >
              {format(day, "d")}
              {hasData && !isSelected && (
                <span className="absolute bottom-1 size-1 rounded-full bg-signal" />
              )}
              {isCurrent && !isSelected && (
                <span className="pointer-events-none absolute inset-0 rounded-md ring-1 ring-inset ring-line-strong" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
