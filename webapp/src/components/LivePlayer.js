"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Square, RadioTower, AlertTriangle } from "lucide-react";
import { usePlayer } from "@/context/PlayerContext";

// Live "Listen Now" feed. Wholly separate from the recorded-clip player
// (PlayerContext / NowPlayingBar / wavesurfer): a live stream has no duration,
// seek or finish, so it uses a plain <audio> element plus a Web Audio
// AnalyserNode that drives the scrolling spectrogram. The audio is pulled from
// the same-origin /api/stream proxy, so the AnalyserNode can read it untainted.

// Map an FFT magnitude (0..1) to a colour along the dark→lime→bright ramp that
// matches the app's single acid-lime signal accent.
function ramp(v) {
  if (v <= 0.001) return "#0a0b0e"; // --color-bg
  if (v < 0.5) {
    const t = v / 0.5;
    return `rgb(${Math.round(10 + t * 40)}, ${Math.round(11 + t * 95)}, ${Math.round(14 + t * 24)})`;
  }
  const t = (v - 0.5) / 0.5;
  return `rgb(${Math.round(50 + t * 175)}, ${Math.round(106 + t * 149)}, ${Math.round(38 + t * 112)})`;
}

const CANVAS_W = 600;
const CANVAS_H = 96;

export default function LivePlayer() {
  const { setIsPlaying, liveActive, setLiveActive } = usePlayer();

  // idle | connecting | live | error
  const [status, setStatus] = useState("idle");

  const audioRef = useRef(null);
  const ctxRef = useRef(null);
  const analyserRef = useRef(null);
  const dataRef = useRef(null);
  const rafRef = useRef(0);
  const canvasRef = useRef(null);
  const playingRef = useRef(false);

  // Lazily build the audio graph once: <audio> → MediaElementSource → Analyser
  // → destination. The Analyser must also reach the destination or the element
  // is muted.
  const ensureAudio = useCallback(() => {
    if (audioRef.current) return audioRef.current;

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtx();
    const audio = new Audio();
    audio.preload = "none";
    audio.crossOrigin = "anonymous"; // same-origin, but explicit & harmless

    const source = ctx.createMediaElementSource(audio);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.6;
    source.connect(analyser);
    analyser.connect(ctx.destination);

    audio.addEventListener("playing", () => setStatus("live"));
    audio.addEventListener("error", () => {
      if (playingRef.current) doStopRef.current();
      setStatus("error");
    });

    audioRef.current = audio;
    ctxRef.current = ctx;
    analyserRef.current = analyser;
    dataRef.current = new Uint8Array(analyser.frequencyBinCount);
    return audio;
  }, []);

  const drawLoop = useCallback(() => {
    rafRef.current = requestAnimationFrame(drawLoop);
    const analyser = analyserRef.current;
    const canvas = canvasRef.current;
    if (!analyser || !canvas) return;
    const ctx2d = canvas.getContext("2d");
    const data = dataRef.current;
    analyser.getByteFrequencyData(data);

    const w = canvas.width;
    const h = canvas.height;
    const bins = data.length;

    // Scroll everything left one pixel, then paint the newest column at the right.
    ctx2d.drawImage(canvas, -1, 0);
    for (let y = 0; y < h; y++) {
      // Top row = highest frequency bin, bottom row = lowest.
      const bin = Math.floor((1 - y / h) * (bins - 1));
      ctx2d.fillStyle = ramp(data[bin] / 255);
      ctx2d.fillRect(w - 1, y, 1, 1);
    }
  }, []);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx2d = canvas.getContext("2d");
    ctx2d.fillStyle = "#0a0b0e";
    ctx2d.fillRect(0, 0, canvas.width, canvas.height);
  }, []);

  // Stable doStop reachable from the (once-created) audio error handler.
  const doStopRef = useRef(null);
  const doStop = useCallback(() => {
    playingRef.current = false;
    cancelAnimationFrame(rafRef.current);
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      // Drop the connection so the proxy stops streaming while we're paused.
      audio.removeAttribute("src");
      audio.load();
    }
    setStatus((s) => (s === "error" ? "error" : "idle"));
  }, []);
  doStopRef.current = doStop;

  const startLive = useCallback(async () => {
    const audio = ensureAudio();
    setStatus("connecting");
    clearCanvas();
    audio.src = "/api/stream";
    try {
      if (ctxRef.current.state === "suspended") await ctxRef.current.resume();
      await audio.play();
    } catch {
      setStatus("error");
      return;
    }
    playingRef.current = true;
    setLiveActive(true); // claim audio focus
    setIsPlaying(false); // pause the recorded-clip player
    drawLoop();
  }, [ensureAudio, clearCanvas, drawLoop, setLiveActive, setIsPlaying]);

  const stopLive = useCallback(() => {
    doStop();
    setLiveActive(false);
  }, [doStop, setLiveActive]);

  // If the recorded player takes over (liveActive flips false elsewhere), stop.
  useEffect(() => {
    if (!liveActive && playingRef.current) doStop();
  }, [liveActive, doStop]);

  // Tear down on unmount (e.g. the panel is closed mid-stream).
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      if (audioRef.current) audioRef.current.pause();
      if (ctxRef.current) ctxRef.current.close().catch(() => {});
      if (playingRef.current) setLiveActive(false);
    };
  }, [setLiveActive]);

  const playing = status === "connecting" || status === "live";

  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-surface/70 p-3 sm:gap-4">
      <button
        aria-label={playing ? "Stop live stream" : "Listen live"}
        onClick={playing ? stopLive : startLive}
        className="grid size-11 shrink-0 place-items-center rounded-full bg-signal text-bg transition-transform hover:scale-105 active:scale-95"
      >
        {playing ? (
          <Square className="size-4" fill="currentColor" />
        ) : (
          <Play className="size-5 translate-x-px" fill="currentColor" />
        )}
      </button>

      <div className="w-24 shrink-0">
        <div className="flex items-center gap-1.5">
          <RadioTower
            className={`size-4 ${status === "live" ? "text-signal animate-pulse-signal" : "text-faint"}`}
          />
          <span className="font-mono text-xs font-medium uppercase tracking-[0.15em] text-fg">
            Live
          </span>
        </div>
        <div className="mt-0.5 font-mono text-[0.6rem] uppercase tracking-[0.15em] text-muted">
          {status === "live"
            ? "On air"
            : status === "connecting"
              ? "Connecting"
              : status === "error"
                ? "Unavailable"
                : "Off air"}
        </div>
      </div>

      <div className="relative min-w-0 flex-1 overflow-hidden rounded-md border border-line bg-bg">
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          className="block h-16 w-full"
        />
        {status === "error" && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-faint">
            <AlertTriangle className="size-4" />
            <span className="font-mono text-[0.65rem] uppercase tracking-[0.15em]">
              Stream unavailable
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
