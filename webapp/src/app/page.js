'use client'
import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import AudioCard from '@/components/AudioCard'
import DayPager from '@/components/DayPager'

export default function Home() {
  const [date, setDate] = useState(() => new Date())
  const [waves, setWaves] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    const fetchData = async () => {
      const response = await fetch(`/api?date=${format(date, 'yyyyMMdd')}`)
      const result = await response.json()
      if (!cancelled) {
        setWaves(result)
        setLoading(false)
      }
    }

    fetchData()
    return () => { cancelled = true }
  }, [date])

  return (
    <main>
      <div className="text-center mt-4 col-md-6 mx-auto">
        <h1>WaveBrowser</h1>
        <DayPager date={date} onChange={setDate} />

        {loading ? (
          <p className="text-muted">Loading…</p>
        ) : waves.length === 0 ? (
          <p className="text-muted">No recordings for this day.</p>
        ) : (
          waves.map((item) => <AudioCard key={item._id} item={item} />)
        )}
      </div>
    </main>
  )
}
