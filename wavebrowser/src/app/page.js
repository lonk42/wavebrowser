'use client'
import { useState, useEffect } from "react"
import { format } from 'date-fns'

// Build the card elements with the given waves
const renderDisplayedWaves = (waves) => {
  if (waves === null) {
    return '';
  }

  return waves.map((item, index) => <AudioCards key={index} item={item} />);
};

// The full scope element for each recording
const AudioCards = ({ item }) => {
  const [progress, setProgress] = useState(0);
  const [audio, setAudio] = useState(null);
  const [audioDuration, setAudioDuration] = useState(null);

  useEffect(() => {
    // Preload audio to get duration
    const preloadAudio = new Audio(`${item.file_path}/${item.filename}`);
    preloadAudio.addEventListener('loadedmetadata', () => {
      setAudioDuration(Math.round(preloadAudio.duration)); // Round to nearest second
    });

    return () => { preloadAudio.removeEventListener('loadedmetadata', () => {}) }
  }, [item.file_path, item.filename]);

  useEffect(() => {
    if (audio) {
      const updateProgress = () => {
        setProgress((audio.currentTime / audio.duration) * 100);
      };

      audio.addEventListener('timeupdate', updateProgress);
      audio.addEventListener('ended', () => setProgress(0));

      return () => {
        audio.removeEventListener('timeupdate', updateProgress);
        audio.removeEventListener('ended', () => setProgress(0));
      };
    }
  }, [audio]);

  const playAudio = (audioUrl) => {
    if (audio) {
      audio.pause();
      setProgress(0);
    }
    const newAudio = new Audio(audioUrl);
    setAudio(newAudio);
    newAudio.play().catch((e)=>{})
  };

  return (
    <div
      className="card mb-3 position-relative"
      style={{
        maxWidth: "90%",
        backgroundColor: "#6a0dad",
        borderBottom: "5px solid transparent",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div className="row g-0">
        <div
          className="col-auto"
          style={{ width: "100px", backgroundColor: "#5a0099", cursor: "pointer" }}
          onClick={() => playAudio(`${item.file_path}/${item.filename}`)}
        >
          <div className="d-flex flex-column justify-content-center align-items-center h-100">
            <i className="bi bi-soundwave" style={{ fontSize: "3rem" }}></i>
            <p className="card-text"><small className="text-muted">{item.frequency_hz / 1000000} Mhz</small></p>
          </div>
        </div>

        <div
          className="col-auto"
          style={{ width: "100px", backgroundColor: "#5a0099", cursor: "pointer" }}
          onClick={() => playAudio(`${item.file_path}/${item.filename}`)}
        >
          <div className="d-flex flex-column justify-content-center align-items-center h-100 position-relative">
            <p className="card-text mb-0 position-absolute top-25 translate-middle-y">{format(new Date(item.date), 'HH:mm:ss')}</p>
            {audioDuration !== null && (
              <p className="card-text mb-0 position-absolute top-50 translate-middle-y" style={{ "paddingTop": "10px" }}>
                <small className="text-muted">{audioDuration}s</small>
              </p>
            )}
            <p className="card-text mb-0 position-absolute bottom-0"><small className="text-muted">{format(new Date(item.date), 'yyyy/MM/dd')}</small></p>
          </div>
        </div>

        <div className="col d-flex align-items-center" style={{ textAlign: "left" }}>
          <div className="card-body">
            <p className="card-text">{item.transcriptions.openai_whisper.transcription}</p>
          </div>
        </div>
      </div>

      {/* Progress Bar as Bottom Border */}
      <div
        className="progress-bar"
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          width: `${progress}%`,
          height: "5px",
          backgroundColor: "#ff9900",
          transition: "width 0.1s linear"
        }}
      ></div>
    </div>
  );
};

export default function Home() {
  const [displayedWaves, setDisplayedWaves] = useState(null);

  // Get a base set of data from mongo
  useEffect(() => {
    const fetchData = async () => {
        const response = await fetch('/api?date=20241225');
        const result = await response.json();
        setDisplayedWaves(result);
    }
    fetchData()
  }, [])

  return (
  <main>
    <div className="text-center mt-4 col-md-6 mx-auto"> 
      <h1>WaveBrowser</h1>
      <center>{renderDisplayedWaves(displayedWaves)}</center>
    </div>
	</main>
  )
}

