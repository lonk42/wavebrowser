'use client'
import { format } from 'date-fns'
import { useAudioPlayer } from '@/hooks/useAudioPlayer'

// A single recording: frequency + timestamp on the left, transcription on the
// right, with a play button and a progress bar along the bottom border.
export default function AudioCard({ item }) {
  const { progress, duration, play } = useAudioPlayer(item.audioUrl)
  const date = new Date(item.date)

  return (
    <div
      className="card mb-3 position-relative"
      style={{
        maxWidth: '90%',
        backgroundColor: '#6a0dad',
        overflow: 'hidden',
      }}
    >
      <div className="row g-0">
        <div
          className="col-auto"
          style={{ width: '100px', backgroundColor: '#5a0099', cursor: 'pointer' }}
          onClick={play}
        >
          <div className="d-flex flex-column justify-content-center align-items-center h-100">
            <i className="bi bi-soundwave" style={{ fontSize: '3rem' }}></i>
            <p className="card-text"><small className="text-muted">{item.frequency_hz / 1000000} Mhz</small></p>
          </div>
        </div>

        <div
          className="col-auto"
          style={{ width: '100px', backgroundColor: '#5a0099', cursor: 'pointer' }}
          onClick={play}
        >
          <div className="d-flex flex-column justify-content-center align-items-center h-100 position-relative">
            <p className="card-text mb-0 position-absolute top-25 translate-middle-y">{format(date, 'HH:mm:ss')}</p>
            {duration !== null && (
              <p className="card-text mb-0 position-absolute top-50 translate-middle-y" style={{ paddingTop: '10px' }}>
                <small className="text-muted">{duration}s</small>
              </p>
            )}
            <p className="card-text mb-0 position-absolute bottom-0"><small className="text-muted">{format(date, 'yyyy/MM/dd')}</small></p>
          </div>
        </div>

        <div className="col d-flex align-items-center" style={{ textAlign: 'left' }}>
          <div className="card-body">
            <p className="card-text">{item.transcription}</p>
          </div>
        </div>
      </div>

      <div
        className="progress-bar"
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          width: `${progress}%`,
          height: '5px',
          backgroundColor: '#ff9900',
          transition: 'width 0.1s linear',
        }}
      ></div>
    </div>
  )
}
