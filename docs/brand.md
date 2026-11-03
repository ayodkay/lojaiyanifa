# Brand and design tokens

The storefront uses an editorial, calm "museum shop catalogue" direction with
neutral tokens until the owner supplies brand assets. **All visual identity lives
in the `@theme` block of `app/app.css`.**

## Swapping in the real brand

| Asset | Where | How |
| --- | --- | --- |
| Logo | Prismic → Store settings → Logo | Upload an SVG/PNG. The header switches from the text wordmark to the image automatically. |
| Favicon / app icons | `public/` | Replace `favicon.svg` (keep the file name). There is no `favicon.ico`: `firebase.json` redirects `/favicon.ico` to the SVG. To ship a real `favicon.ico`, add it to `public/` and remove that redirect, because Hosting applies redirects before files. |
| Display font (headings) | `app/app.css` | Self-host the font files in `public/fonts/`, add `@font-face` rules, set `--font-display`. Self-hosting avoids sending visitor IPs to a font CDN (LGPD) and is faster. |
| Body font | `app/app.css` | Same, `--font-sans`. |
| Primary colour (buttons, active states) | `app/app.css` | `--color-accent` and `--color-accent-contrast` (text on the accent). |
| Background / text | `app/app.css` | `--color-paper`, `--color-ink` (+ `-soft`, `muted`). |

After changing colours, re-check contrast (WCAG 2.2 AA): text ≥ 4.5:1, large text
and UI component boundaries ≥ 3:1.

## Current contrast (computed with the WCAG relative-luminance formula)

| Pair | Ratio | Requirement |
| --- | --- | --- |
| ink `#1e1a15` on paper `#f6f3ec` | ≈ 16:1 | text 4.5:1 ✓ |
| muted `#5c554b` on paper | 6.6:1 | text 4.5:1 ✓ |
| sale `#9a3412` on white / paper | 7.3:1 / 6.6:1 | text 4.5:1 ✓ |
| success `#2e6b3f` on paper | 5.8:1 | text 4.5:1 ✓ |
| warning `#8a5a00` on paper | 5.4:1 | text 4.5:1 ✓ |
| danger `#a11d1d` on paper | 7.0:1 | text 4.5:1 ✓ |
| line-strong `#8a8174` (form field borders) on paper | 3.5:1 | UI boundary 3:1 ✓ |
| WhatsApp button `#1f7a4d` with white icon | 5.3:1 | UI 3:1 ✓ |
| line `#ddd5c6` | ~1.3:1 | decorative dividers only — never used as a control boundary |

## Principles

- Product photography is the hero; the UI stays quiet around it.
- No sacred symbols (Odu marks, Opon Ifá motifs) are used as decoration without
  the owner's guidance; placeholders use neutral concentric circles.
- Motion: one entrance reveal on the homepage hero; everything respects
  `prefers-reduced-motion`.
