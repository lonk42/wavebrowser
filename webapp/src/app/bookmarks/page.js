"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, Star } from "lucide-react";
import { PlayerProvider, usePlayer } from "@/context/PlayerContext";
import RecordingCard from "@/components/RecordingCard";
import NowPlayingBar from "@/components/NowPlayingBar";

// Local YYYYMMDD for a recording, matching how the dashboard reads ?date= (it
// parses the digits as a *local* calendar day). Used to deep-link back to the
// day + card this bookmark lives on.
const localYmd = (d) => {
  const x = new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
};

export default function BookmarksPage() {
  return (
    <PlayerProvider>
      <Bookmarks />
    </PlayerProvider>
  );
}

function Bookmarks() {
  const { setTracks } = usePlayer();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/bookmarks", { cache: "no-store" });
        const result = await res.json();
        if (!cancelled && Array.isArray(result)) setItems(result);
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // The player navigates this same newest-first list.
  useEffect(() => {
    setTracks(items);
  }, [items, setTracks]);

  // Un-starring here removes the card from the list (optimistic). Re-adds it if
  // the write fails.
  const handleToggleBookmark = (id, next) => {
    if (next) return; // this page only ever un-stars
    const removed = items.find((it) => it._id === id);
    setItems((prev) => prev.filter((it) => it._id !== id));
    fetch("/api/bookmark", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, bookmarked: false }),
    })
      .then((r) => {
        if (!r.ok) throw new Error("bookmark failed");
      })
      .catch(() => {
        if (removed) {
          setItems((prev) =>
            [removed, ...prev].sort((a, b) => new Date(b.date) - new Date(a.date))
          );
        }
      });
  };

  // Set a recording's shared thumbs feedback ("up"/"down"/null), optimistically.
  const handleSetFeedback = (id, next) => {
    const prevVal = items.find((it) => it._id === id)?.flag_feedback ?? null;
    setItems((prev) =>
      prev.map((it) => (it._id === id ? { ...it, flag_feedback: next } : it))
    );
    fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, feedback: next }),
    })
      .then((r) => {
        if (!r.ok) throw new Error("feedback failed");
      })
      .catch(() => {
        setItems((prev) =>
          prev.map((it) => (it._id === id ? { ...it, flag_feedback: prevVal } : it))
        );
      });
  };

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-line bg-bg/80 backdrop-blur-xl">
        <div className="signal-glow pointer-events-none absolute inset-x-0 top-0 h-32" />
        <div className="relative mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 pb-4 pt-5 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-lg border border-star/30 bg-star-soft text-star">
              <Star className="size-5" strokeWidth={2} fill="currentColor" />
            </span>
            <div>
              <h1 className="font-display text-xl font-extrabold leading-none tracking-tight text-fg">
                SAVED
              </h1>
              <p className="mt-1 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-faint">
                {items.length} bookmarked
              </p>
            </div>
          </div>
          <Link
            href="/"
            title="Back to the dashboard"
            className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-2 font-mono text-[0.65rem] uppercase tracking-[0.15em] text-muted transition-colors hover:border-signal/40 hover:text-signal"
          >
            <ArrowLeft className="size-4" />
            Dashboard
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-32 pt-6 sm:px-6">
        {loading ? (
          <div className="py-28 text-center font-mono text-sm uppercase tracking-[0.25em] text-faint">
            Loading…
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-28 text-center">
            <div className="font-mono text-sm uppercase tracking-[0.25em] text-faint">
              No bookmarks yet
            </div>
            <p className="max-w-xs text-sm text-muted">
              Star a transmission on the dashboard to save it here.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {items.map((item, i) => (
              <RecordingCard
                key={item._id}
                item={item}
                index={i}
                onToggleBookmark={handleToggleBookmark}
                onSetFeedback={handleSetFeedback}
                jumpHref={`/?date=${localYmd(item.date)}&focus=${item._id}`}
              />
            ))}
          </div>
        )}
      </main>

      <NowPlayingBar />
    </div>
  );
}
