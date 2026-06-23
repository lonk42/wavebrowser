"use client";
import { createContext, useContext, useState, useCallback, useMemo } from "react";

const PlayerContext = createContext(null);

export function PlayerProvider({ children }) {
  // The list the player navigates (the currently filtered/displayed recordings).
  const [tracks, setTracks] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  // Whether the live stream (LivePlayer) currently holds audio focus. Recorded
  // playback and the live stream are mutually exclusive: starting one releases
  // the other.
  const [liveActive, setLiveActive] = useState(false);

  const current = useMemo(
    () => tracks.find((t) => t._id === currentId) ?? null,
    [tracks, currentId]
  );

  const playTrack = useCallback(
    (item) => {
      setLiveActive(false); // recorded playback takes over from the live stream
      if (item._id === currentId) {
        setIsPlaying((p) => !p);
      } else {
        setCurrentId(item._id);
        setIsPlaying(true);
      }
    },
    [currentId]
  );

  const toggle = useCallback(() => setIsPlaying((p) => !p), []);

  const step = useCallback(
    (delta) => {
      setCurrentId((id) => {
        const i = tracks.findIndex((t) => t._id === id);
        if (i === -1) return id;
        const next = tracks[i + delta];
        if (!next) return id;
        setLiveActive(false);
        setIsPlaying(true);
        return next._id;
      });
    },
    [tracks]
  );

  const next = useCallback(() => step(1), [step]);
  const prev = useCallback(() => step(-1), [step]);

  const hasNext = useMemo(() => {
    const i = tracks.findIndex((t) => t._id === currentId);
    return i !== -1 && i < tracks.length - 1;
  }, [tracks, currentId]);

  const hasPrev = useMemo(() => {
    const i = tracks.findIndex((t) => t._id === currentId);
    return i > 0;
  }, [tracks, currentId]);

  const value = {
    tracks,
    setTracks,
    current,
    currentId,
    isPlaying,
    setIsPlaying,
    liveActive,
    setLiveActive,
    playTrack,
    toggle,
    next,
    prev,
    hasNext,
    hasPrev,
  };

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used within a PlayerProvider");
  return ctx;
}
