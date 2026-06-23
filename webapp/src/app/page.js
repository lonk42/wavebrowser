"use client";
import { useState, useEffect, useMemo } from "react";
import { format } from "date-fns";
import { PlayerProvider, usePlayer } from "@/context/PlayerContext";
import AppHeader from "@/components/AppHeader";
import RecordingCard from "@/components/RecordingCard";
import NowPlayingBar from "@/components/NowPlayingBar";

export default function Home() {
  return (
    <PlayerProvider>
      <Dashboard />
    </PlayerProvider>
  );
}

function Dashboard() {
  const { setTracks } = usePlayer();

  const [date, setDate] = useState(() => new Date());
  const [waves, setWaves] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [activeFreq, setActiveFreq] = useState(null);
  const [liveOpen, setLiveOpen] = useState(false);

  // Fetch a day's recordings.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setActiveFreq(null);
    setQuery("");

    (async () => {
      const res = await fetch(`/api?date=${format(date, "yyyyMMdd")}`);
      const result = await res.json();
      if (!cancelled) {
        setWaves(Array.isArray(result) ? result : []);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [date]);

  const freqs = useMemo(
    () => [...new Set(waves.map((w) => w.frequency_hz))].sort(),
    [waves]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return waves.filter((w) => {
      if (activeFreq && w.frequency_hz !== activeFreq) return false;
      if (q && !(w.transcription || "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [waves, query, activeFreq]);

  // The player navigates whatever is currently visible.
  useEffect(() => {
    setTracks(filtered);
  }, [filtered, setTracks]);

  // Jump the list to the recording nearest a clicked point on the timeline.
  const handlePickTime = (fraction) => {
    if (filtered.length === 0) return;
    const targetSec = fraction * 86400;
    const secOfDay = (d) => {
      const x = new Date(d);
      return x.getHours() * 3600 + x.getMinutes() * 60 + x.getSeconds();
    };
    const match =
      filtered.find((w) => secOfDay(w.date) >= targetSec) ?? filtered[filtered.length - 1];
    const el = document.getElementById(`rec-${match._id}`);
    if (!el) return;
    const headerH = document.querySelector("header")?.offsetHeight ?? 0;
    const y = el.getBoundingClientRect().top + window.scrollY - headerH - 12;
    window.scrollTo({ top: y, behavior: "smooth" });
  };

  return (
    <div className="min-h-dvh">
      <AppHeader
        date={date}
        onDateChange={setDate}
        query={query}
        onQueryChange={setQuery}
        freqs={freqs}
        activeFreq={activeFreq}
        onFreqChange={setActiveFreq}
        count={filtered.length}
        items={filtered}
        onPickTime={handlePickTime}
        liveOpen={liveOpen}
        onToggleLive={() => setLiveOpen((v) => !v)}
      />

      <main className="mx-auto max-w-5xl px-4 pb-32 pt-6 sm:px-6">
        {loading ? (
          <SkeletonList />
        ) : filtered.length === 0 ? (
          <EmptyState hasData={waves.length > 0} />
        ) : (
          <div className="flex flex-col gap-2.5">
            {filtered.map((item, i) => (
              <RecordingCard key={item._id} item={item} index={i} />
            ))}
          </div>
        )}
      </main>

      <NowPlayingBar />
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="flex flex-col gap-2.5">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 rounded-xl border border-line bg-surface p-4"
          style={{ opacity: 1 - i * 0.13 }}
        >
          <div className="size-11 shrink-0 rounded-full bg-elevated" />
          <div className="w-[5.5rem] shrink-0 space-y-2 border-r border-line pr-4">
            <div className="h-4 w-16 rounded bg-elevated" />
            <div className="h-3 w-12 rounded bg-elevated" />
          </div>
          <div className="flex-1 space-y-2">
            <div className="h-3 w-full rounded bg-elevated" />
            <div className="h-3 w-2/3 rounded bg-elevated" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ hasData }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-28 text-center">
      <div className="font-mono text-sm uppercase tracking-[0.25em] text-faint">
        {hasData ? "No matches" : "No transmissions"}
      </div>
      <p className="max-w-xs text-sm text-muted">
        {hasData
          ? "Nothing matches your search on this day. Try clearing the filter."
          : "There are no transcribed recordings for this day."}
      </p>
    </div>
  );
}
