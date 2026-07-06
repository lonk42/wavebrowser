"use client";
import { useState, useEffect, useMemo, useRef } from "react";
import { PlayerProvider, usePlayer } from "@/context/PlayerContext";
import AppHeader from "@/components/AppHeader";
import RecordingCard from "@/components/RecordingCard";
import NowPlayingBar from "@/components/NowPlayingBar";

const secOfDay = (d) => {
  const x = new Date(d);
  return x.getHours() * 3600 + x.getMinutes() * 60 + x.getSeconds();
};

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
  const [autoscroll, setAutoscroll] = useState(true);
  // [startFraction, endFraction] of the day currently within the viewport, used
  // to draw the "you are here" window on the timeline. null when nothing's shown.
  const [visibleRange, setVisibleRange] = useState(null);
  // Ids of recordings that arrived *live* (via SSE) rather than in the initial
  // day load, so their cards can slide in instead of using the load-time
  // staggered reveal. `seenIds` is the dedup source of truth across the fetch
  // and the live merges.
  const [recentIds, setRecentIds] = useState(() => new Set());
  const seenIdsRef = useRef(new Set());
  // A recording id to scroll to once its day is loaded, read from a deep link
  // (?date=YYYYMMDD&focus=<id>) opened from the Bookmarks page. Consumed once.
  const focusIdRef = useRef(null);
  const didInitFromUrl = useRef(false);

  // Read the deep-link params on mount only (client-side, so no SSR/hydration
  // mismatch). Selecting the target day re-runs the day fetch below.
  useEffect(() => {
    if (didInitFromUrl.current) return;
    didInitFromUrl.current = true;
    const p = new URLSearchParams(window.location.search);
    const focus = p.get("focus");
    const d = p.get("date");
    if (focus) {
      focusIdRef.current = focus;
      setAutoscroll(false); // don't let snap-to-top fight the jump
    }
    if (d && /^\d{8}$/.test(d)) {
      const parsed = new Date(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8));
      if (!isNaN(parsed)) setDate(parsed);
    }
  }, []);

  // Fetch a day's recordings, then — while viewing the current day — subscribe
  // to a live SSE stream so new transcriptions appear within ~1s of being
  // written, without re-fetching the whole day.
  useEffect(() => {
    let cancelled = false;

    // Send the selected *local* day's bounds as UTC instants so the server
    // (which stores/queries UTC) returns the day the user actually sees,
    // regardless of timezone. Passing a bare YYYYMMDD would be misread as a
    // UTC day and drop a chunk of a non-UTC user's day.
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const url = `/api?start=${start.toISOString()}&end=${end.toISOString()}`;

    // Merge live items into the day, keyed by _id so existing cards and the
    // now-playing track are untouched and new ones slot in by time. Items not
    // already seen (this fetch or a prior merge) are the ones to animate in.
    const mergeIntoDay = (incoming) => {
      const added = incoming.filter((it) => {
        const t = new Date(it.date);
        return t >= start && t < end && !seenIdsRef.current.has(it._id);
      });
      if (added.length === 0) return;
      for (const it of added) seenIdsRef.current.add(it._id);
      setWaves((prev) => {
        const byId = new Map(prev.map((w) => [w._id, w]));
        for (const it of added) byId.set(it._id, it);
        return [...byId.values()].sort(
          (a, b) => new Date(a.date) - new Date(b.date)
        );
      });
      setRecentIds((prev) => {
        const next = new Set(prev);
        for (const it of added) next.add(it._id);
        return next;
      });
    };

    // New day selected: show the skeleton and reset filters and the
    // seen/recent tracking. Live merges only touch the data, so active
    // search/frequency filters survive.
    setLoading(true);
    setActiveFreq(null);
    setQuery("");
    seenIdsRef.current = new Set();
    setRecentIds(new Set());

    (async () => {
      try {
        const res = await fetch(url, { cache: "no-store" });
        const result = await res.json();
        if (!cancelled && Array.isArray(result)) {
          for (const r of result) seenIdsRef.current.add(r._id);
          setWaves(result);
        }
      } catch {
        if (!cancelled) setWaves([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    // Only the current local day grows, so only stream then. EventSource
    // auto-reconnects on its own if the connection drops.
    const isToday = start.toDateString() === new Date().toDateString();
    let es = null;
    if (isToday) {
      es = new EventSource("/api/events");
      es.onmessage = (ev) => {
        if (cancelled) return;
        let items;
        try {
          items = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (Array.isArray(items) && items.length) mergeIntoDay(items);
      };
    }

    return () => {
      cancelled = true;
      if (es) es.close();
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

  // Display newest-first. `filtered` stays chronological (used by the timeline's
  // pick logic); `view` is the reversed list the card list renders.
  const view = useMemo(() => [...filtered].reverse(), [filtered]);

  // The player navigates the chronological list, not the reversed display order,
  // so next()/auto-advance move *forward in time* (older -> newer). With the
  // newest-first `view` the player stepped backwards in time instead. Navigation
  // is keyed by id + index, so the order it sees is independent of render order.
  useEffect(() => {
    setTracks(filtered);
  }, [filtered, setTracks]);

  // Autoscroll: when on, keep the list pinned to the top so freshly-arrived
  // recordings (which now appear at the top) stay in view. Only nudges when the
  // count actually grows, so it never fights the user mid-scroll otherwise.
  const prevCount = useRef(0);
  useEffect(() => {
    if (autoscroll && waves.length > prevCount.current) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    prevCount.current = waves.length;
  }, [waves, autoscroll]);

  // Auto-following disengages as soon as the user scrolls down, away from the
  // top, so the "Auto" button reflects whether the list is actually pinned.
  // Only a downward scroll counts: the programmatic snap-to-top (and a manual
  // scroll-up) moves toward the top and must not turn following off.
  const lastYRef = useRef(0);
  useEffect(() => {
    if (!autoscroll) return;
    lastYRef.current = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (y > lastYRef.current + 4 && y > 8) setAutoscroll(false);
      lastYRef.current = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [autoscroll]);

  // Track which cards are currently within the viewport (below the sticky
  // header) and report their time-span as a fraction of the day, so the timeline
  // can highlight the window the user is looking at. Recomputed on scroll/resize,
  // throttled to one measurement per frame.
  useEffect(() => {
    if (loading || view.length === 0) {
      setVisibleRange(null);
      return;
    }
    let raf = 0;
    const compute = () => {
      raf = 0;
      const headerH = document.querySelector("header")?.offsetHeight ?? 0;
      const bottom = window.innerHeight;
      let lo = Infinity;
      let hi = -Infinity;
      for (const w of view) {
        const el = document.getElementById(`rec-${w._id}`);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.bottom < headerH || r.top > bottom) continue;
        const f = secOfDay(w.date) / 86400;
        if (f < lo) lo = f;
        if (f > hi) hi = f;
      }
      setVisibleRange(lo <= hi ? [lo, hi] : null);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(compute);
    };
    compute();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [view, loading]);

  // Toggle a recording's shared bookmark flag, optimistically. Reverts the
  // local state if the write fails.
  const handleToggleBookmark = (id, next) => {
    setWaves((prev) =>
      prev.map((w) => (w._id === id ? { ...w, bookmarked: next } : w))
    );
    fetch("/api/bookmark", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, bookmarked: next }),
    })
      .then((r) => {
        if (!r.ok) throw new Error("bookmark failed");
      })
      .catch(() => {
        setWaves((prev) =>
          prev.map((w) => (w._id === id ? { ...w, bookmarked: !next } : w))
        );
      });
  };

  // Once the deep-linked day has loaded, scroll its target card into view and
  // flash it. Consumes focusIdRef so it only fires once.
  useEffect(() => {
    if (loading) return;
    const id = focusIdRef.current;
    if (!id) return;
    const el = document.getElementById(`rec-${id}`);
    if (!el) return; // not on this day (or not yet rendered) — leave it armed
    focusIdRef.current = null;
    const headerH = document.querySelector("header")?.offsetHeight ?? 0;
    const y = el.getBoundingClientRect().top + window.scrollY - headerH - 12;
    window.scrollTo({ top: y, behavior: "smooth" });
    el.classList.add("animate-focus-flash");
    const t = setTimeout(() => el.classList.remove("animate-focus-flash"), 2000);
    return () => clearTimeout(t);
  }, [loading, view]);

  // Jump the list to the recording nearest a clicked point on the timeline.
  const handlePickTime = (fraction) => {
    if (filtered.length === 0) return;
    const targetSec = fraction * 86400;
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
        visibleRange={visibleRange}
        onPickTime={handlePickTime}
        liveOpen={liveOpen}
        onToggleLive={() => setLiveOpen((v) => !v)}
        autoscroll={autoscroll}
        onToggleAutoscroll={() =>
          setAutoscroll((v) => {
            if (!v) window.scrollTo({ top: 0, behavior: "smooth" });
            return !v;
          })
        }
      />

      <main className="mx-auto max-w-5xl px-4 pb-32 pt-6 sm:px-6">
        {loading ? (
          <SkeletonList />
        ) : filtered.length === 0 ? (
          <EmptyState hasData={waves.length > 0} />
        ) : (
          <div className="flex flex-col gap-2.5">
            {view.map((item, i) => (
              <RecordingCard
                key={item._id}
                item={item}
                index={i}
                isNew={recentIds.has(item._id)}
                onToggleBookmark={handleToggleBookmark}
              />
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
