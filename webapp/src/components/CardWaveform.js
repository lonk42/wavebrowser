// Static, presentational waveform drawn full-bleed behind a recording card.
// `peaks` is the downsampled 0..1 envelope the transcriber stored on the doc;
// renders nothing when it's absent/empty (older docs) so those cards stay clean.
// Color is inherited via currentColor, and opacity is set by the parent, so the
// active/playing card can brighten it with a simple class swap.
export default function CardWaveform({ peaks }) {
  if (!Array.isArray(peaks) || peaks.length === 0) return null;

  const n = peaks.length;
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox={`0 0 ${n} 100`}
      preserveAspectRatio="none"
    >
      {peaks.map((p, i) => {
        // Mirror each bar around the vertical midline for a classic waveform.
        // Clamp to a sliver so even near-silent buckets stay visible.
        const h = Math.max(2, p * 100);
        return (
          <rect
            key={i}
            x={i + 0.15}
            width={0.7}
            y={50 - h / 2}
            height={h}
            fill="currentColor"
          />
        );
      })}
    </svg>
  );
}
