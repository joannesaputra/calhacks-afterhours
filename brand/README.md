# AfterHours brand assets

The mark is a horizon line with two clock hands that start at one point and rise into the evening. The wordmark is
AFTERHOURS in Helvetica Neue Medium (weight 500), uppercase, letter-spacing 0.22em.

| File | Use |
|---|---|
| `afterhours-logo-black.svg/.png`, `afterhours-logo-white.svg/.png` | Horizontal lockup on light and on dark backgrounds |
| `afterhours-mark-black.svg/.png`, `afterhours-mark-white.svg/.png` | Mark only |
| `afterhours-icon.svg/.png` | App icon (white mark on a dark rounded square) |
| `afterhours-brand-preview.png` | Overview sheet |

Colors: `#0a0a0a` and `#ffffff` only; the second hand is the same color at 60% opacity.

In the application the mark is `apps/web/components/brand.tsx`, the favicon is `apps/web/app/icon.svg` and the touch icon is
`apps/web/app/apple-icon.png`. If the geometry changes, update those and these files together.

Limitation: the SVG lockups use live text for the wordmark, so a machine without Helvetica Neue substitutes another
sans-serif. The PNGs are rendered with the intended font. Outline the text before using an SVG lockup in print.
