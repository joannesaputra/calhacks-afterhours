/**
 * AfterHours mark: a horizon line with two clock hands that start at the same point (the long hand's base, just below
 * the line) and rise into the evening. Geometry matches brand/afterhours-mark-*.svg; keep the two in step.
 */
export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 34 22" fill="none" aria-hidden>
      <path d="M2 17.5h30" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M9 19 25 3" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" />
      <path d="M9 19 30 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" opacity=".6" />
    </svg>
  );
}
