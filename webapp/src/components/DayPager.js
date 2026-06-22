'use client'
import { format, addDays, isToday } from 'date-fns'

// Prev / current-day / next navigation. "Next" is disabled once we reach today
// since there are no future recordings.
export default function DayPager({ date, onChange }) {
  return (
    <div className="d-flex justify-content-center align-items-center gap-3 mb-4">
      <button className="btn btn-outline-light" onClick={() => onChange(addDays(date, -1))}>
        <i className="bi bi-chevron-left"></i>
      </button>

      <div className="text-center" style={{ minWidth: '160px' }}>
        <div>{format(date, 'EEEE')}</div>
        <strong>{format(date, 'yyyy/MM/dd')}</strong>
      </div>

      <button
        className="btn btn-outline-light"
        onClick={() => onChange(addDays(date, 1))}
        disabled={isToday(date)}
      >
        <i className="bi bi-chevron-right"></i>
      </button>
    </div>
  )
}
