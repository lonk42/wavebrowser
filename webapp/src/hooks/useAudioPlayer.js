'use client'
import { useEffect, useRef, useState } from 'react'

// Manages a single HTMLAudioElement for one source: exposes playback progress
// (0-100), duration in seconds, and a play() that restarts from the beginning.
export function useAudioPlayer(src) {
  const audioRef = useRef(null)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(null)

  useEffect(() => {
    const audio = new Audio(src)
    audioRef.current = audio

    const onLoadedMetadata = () => setDuration(Math.round(audio.duration))
    const onTimeUpdate = () => setProgress((audio.currentTime / audio.duration) * 100)
    const onEnded = () => setProgress(0)

    audio.addEventListener('loadedmetadata', onLoadedMetadata)
    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('ended', onEnded)

    return () => {
      audio.pause()
      audio.removeEventListener('loadedmetadata', onLoadedMetadata)
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('ended', onEnded)
    }
  }, [src])

  const play = () => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = 0
    setProgress(0)
    audio.play().catch(() => {})
  }

  return { progress, duration, play }
}
