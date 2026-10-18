/**
 * GamCiv brand mark: a royal-blue rounded tile carrying a custom "G" whose
 * crossbar is a green checkmark plugged into the letter's terminal — the
 * promise of the product (reported, routed, resolved) inside the name.
 *
 * Geometry is identical to public/favicon.svg; colors are brand constants
 * (royal blue #1E40AF, white, service green #22C55E — the on-blue tint of
 * brand green #16A34A) so the mark renders the same everywhere.
 */
export default function GamCivMark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true" focusable="false">
      <rect width="48" height="48" rx="10.5" fill="#1E40AF" />
      <g fill="none" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round">
        <path stroke="#FFFFFF" d="M 29.88 14.17 A 12 12 0 1 0 34.59 27.11" />
        <path stroke="#22C55E" d="M 25.2 27.6 L 28.4 30.8 L 34.59 27.11" />
      </g>
    </svg>
  )
}
