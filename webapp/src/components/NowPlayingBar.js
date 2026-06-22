"use client";
import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { Play, Pause, SkipBack, SkipForward, Radio } from "lucide-react";
import { usePlayer } from "@/context/PlayerContext";

const mhz = (hz) => (Number(hz) / 1e6).toFixed(3);
const clock = (s) => {
  if (!Number.isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
};

export default function NowPlayingBar() {
  const {
    current,
    isPlaying,
    setIsPlaying,
    toggle,
    next,
    prev,
    hasNext,
    hasPrev,
  } = usePlayer();

  const containerRef = useRef(null);
  const wsRef = useRef(null);
  const readyRef = useRef(false);
  // Keep the latest navigation callbacks reachable from stable wavesurfer events.
  const navRef = useRef({ next, hasNext });
  navRef.current = { next, hasNext };
  // Latest selected URL, reachable from the (async) instance-creation effect.
  const currentUrlRef = useRef(current?.audioUrl ?? null);
  currentUrlRef.current = current?.audioUrl ?? null;
  // Whether playback is intended, reachable from stable wavesurfer events.
  const shouldPlayRef = useRef(isPlaying);
  shouldPlayRef.current = isPlaying;

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Create the wavesurfer instance once.
  useEffect(() => {
    let ws;
    let cancelled = false;

    (async () => {
      const { default: WaveSurfer } = await import("wavesurfer.js");
      if (cancelled || !containerRef.current) return;

      ws = WaveSurfer.create({
        container: containerRef.current,
        height: 40,
        waveColor: "#5b6170",
        progressColor: "#bef24a",
        cursorColor: "#bef24a",
        cursorWidth: 1,
        barWidth: 2,
        barGap: 2,
        barRadius: 4,
        normalize: true,
      });

      ws.on("ready", () => {
        readyRef.current = true;
        setDuration(ws.getDuration());
        // Always start a freshly-loaded track from the beginning; otherwise the
        // play head can sit at the end of the previous track and fire an
        // immediate "finish", skipping every other item during auto-advance.
        ws.setTime(0);
        if (shouldPlayRef.current) ws.play().catch(() => {});
      });
      ws.on("timeupdate", (t) => setCurrentTime(t));
      ws.on("play", () => setIsPlaying(true));
      ws.on("pause", () => setIsPlaying(false));
      ws.on("finish", () => {
        if (navRef.current.hasNext) navRef.current.next();
        else setIsPlaying(false);
      });

      wsRef.current = ws;

      // If a track was already selected before the instance finished loading
      // (e.g. on first mount), load it now — the load effect below won't re-fire
      // because the URL hasn't changed.
      if (currentUrlRef.current) ws.load(currentUrlRef.current).catch(() => {});
    })();

    return () => {
      cancelled = true;
      if (ws) ws.destroy();
      wsRef.current = null;
    };
  }, [setIsPlaying]);

  // Load a new track when the current selection changes.
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || !current) return;
    readyRef.current = false;
    setCurrentTime(0);
    setDuration(0);
    ws.load(current.audioUrl).catch(() => {});
  }, [current?.audioUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync external play/pause intent to the instance.
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || !readyRef.current) return;
    if (isPlaying) ws.play().catch(() => {});
    else ws.pause();
  }, [isPlaying]);

  const idle = !current;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/85 backdrop-blur-xl">
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-3 py-3 sm:gap-5 sm:px-6">
        {/* Transport */}
        <div className="flex items-center gap-1 sm:gap-1.5">
          <TransportButton label="Previous" onClick={prev} disabled={idle || !hasPrev}>
            <SkipBack className="size-4" fill="currentColor" />
          </TransportButton>
          <button
            aria-label={isPlaying ? "Pause" : "Play"}
            onClick={toggle}
            disabled={idle}
            className="grid size-11 place-items-center rounded-full bg-signal text-bg transition-transform hover:scale-105 active:scale-95 disabled:opacity-30 disabled:hover:scale-100"
          >
            {isPlaying ? (
              <Pause className="size-5" fill="currentColor" />
            ) : (
              <Play className="size-5 translate-x-px" fill="currentColor" />
            )}
          </button>
          <TransportButton label="Next" onClick={next} disabled={idle || !hasNext}>
            <SkipForward className="size-4" fill="currentColor" />
          </TransportButton>
        </div>

        {/* Readout */}
        <div className="w-24 shrink-0">
          {idle ? (
            <div className="flex items-center gap-2 text-faint">
              <Radio className="size-4" />
              <span className="font-mono text-xs uppercase tracking-[0.15em]">Idle</span>
            </div>
          ) : (
            <>
              <div className="font-mono text-sm font-medium text-signal">
                {mhz(current.frequency_hz)}
                <span className="ml-1 text-[0.6rem] text-faint">MHz</span>
              </div>
              <div className="font-mono text-[0.65rem] text-muted">
                {format(new Date(current.date), "HH:mm:ss")}
              </div>
            </>
          )}
        </div>

        {/* Waveform + times */}
        <div className="flex flex-1 items-center gap-3">
          <span className="hidden w-9 text-right font-mono text-[0.65rem] text-muted sm:inline">
            {clock(currentTime)}
          </span>
          <div ref={containerRef} className="min-w-0 flex-1" />
          <span className="hidden w-9 font-mono text-[0.65rem] text-faint sm:inline">
            {clock(duration)}
          </span>
        </div>
      </div>
    </div>
  );
}

function TransportButton({ children, label, ...props }) {
  return (
    <button
      aria-label={label}
      className="grid size-9 place-items-center rounded-full text-muted transition-colors hover:text-fg disabled:cursor-not-allowed disabled:opacity-25 disabled:hover:text-muted"
      {...props}
    >
      {children}
    </button>
  );
}
