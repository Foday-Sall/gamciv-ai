/**
 * Flag of The Gambia, reduced to clean bands: red / blue / green with white
 * fimbriations. Official 2:3 ratio, drawn on a 27x18 grid. Shared so the
 * hero and CTA can use the national mark the same way the phone does.
 */
export default function GambiaFlag({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 27 18" role="img" aria-label="Flag of The Gambia" focusable="false">
      <title>Flag of The Gambia</title>
      <rect width="27" height="18" fill="#0F47AF" />
      <rect width="27" height="6.6" fill="#CE1126" />
      <rect y="11.4" width="27" height="6.6" fill="#3A7728" />
      <rect y="6" width="27" height="0.6" fill="#ffffff" />
      <rect y="11.4" width="27" height="0.6" fill="#ffffff" />
    </svg>
  )
}
