import type { Stroke } from "@/lib/gurumi/similarity";

export function StrokeDrawing({ strokes, label, className }: { strokes: Stroke[]; label: string; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 1000 1000" role="img" aria-label={label}>
      <rect width="1000" height="1000" fill="white" />
      {strokes.map(({ points }, index) => points.length === 1 ? (
        <circle key={index} cx={points[0].x * 1000} cy={points[0].y * 1000} r="6" fill="#111111" />
      ) : (
        <polyline key={index} points={points.map(({ x, y }) => `${x * 1000},${y * 1000}`).join(" ")} fill="none" stroke="#111111" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </svg>
  );
}
