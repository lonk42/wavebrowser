'use client'
import { useState, useEffect } from "react";

// Build the card elements with the given waves
const renderDisplayedWaves = (waves) => {
  if (waves === null) {
    return ''
  }

  return waves.map((item, index) => (
  <div key={index} className="card mb-3" style={{ maxWidth: "540px" }}>
    <div className="row g-0">
      <div className="col-md-4">
        <i className="bi bi-soundwave"></i>
      </div>
      <div className="col-md-8">
        <div className="card-body">
          <p className="card-text"><small className="text-muted">{item.filename}</small></p>
          <p className="card-text">{item.transcriptions.openai_whisper.transcription}</p>
        </div>
      </div>
    </div>
  </div>
  ));
};

export default function Home() {
  const [displayedWaves, setDisplayedWaves] = useState(null);

  // Get a base set of data from mongo
  useEffect(() => {
    const fetchData = async () => {
        const response = await fetch('/api');
        const result = await response.json();
        setDisplayedWaves(result);
    }
    fetchData()
  }, [])

  return (
  <main>
    <div className="text-center mt-4 col-md-6 mx-auto"> 
      <h1>WaveBrowser</h1>
      {renderDisplayedWaves(displayedWaves)}
    </div>
	</main>
  )
}

