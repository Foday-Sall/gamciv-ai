/**
 * GamCiv brand mark: deep-green tile, white "G", gold check terminal.
 * Geometry matches public/favicon.svg; colors are brand constants so the
 * mark renders identically to the landing and the future mobile apps.
 */
export default function GamCivMark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true" focusable="false">
      <rect width="48" height="48" rx="10.5" fill="#146C43" />
      <g fill="none" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round">
        <path stroke="#FFFFFF" d="M 29.88 14.17 A 12 12 0 1 0 34.59 27.11" />
        <path stroke="#F0B429" d="M 25.2 27.6 L 28.4 30.8 L 34.59 27.11" />
      </g>
    </svg>
  )
}
