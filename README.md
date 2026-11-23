# Humanized Ohm Meter

A mobile-first game for practicing resistor color codes. It's a static site with no backend and no build step. You can install it as an app on iOS and Android, and it works fully offline.

- A realistic resistor (shaded ceramic body with grain, glossy printed bands, metal leads) drops onto a bench mat. Read the bands and pick the value from 4 choices, or type it with a unit (mΩ, Ω, kΩ, MΩ). Typed answers also accept codes like `4k7`, `R47` and `2M2`.
- After every answer you get the full breakdown, for example: *Brown = 1, Black = 0, Red = ×100 → 1,000 Ω = 1 kΩ, Gold = ±5%*.
- Scoring: +100 per correct answer (+150 for 5-band), a streak bonus of up to +200, a time bonus in timer mode, and −50 per miss. The score never goes below 0.
- Settings: 4-band, 5-band or mixed; milli, kilo and mega ranges; which tolerance colors appear; timer mode; sound and volume; vibration; and color codes printed on the bands (helps with color-vision differences).
- All sounds are synthesized with the Web Audio API, so there are no audio files.
- High score, stats and settings are saved in `localStorage`.

## Structure

```
index.html              app shell (iOS meta tags, manifest link, screens)
manifest.webmanifest    PWA manifest (standalone, icons incl. maskable)
sw.js                   service worker: versioned precache, offline, update prompt
css/styles.css          all styles (dark bench-mat theme, safe areas, reduced motion)
js/core.js              pure resistor math, value formatting, options, answer parsing
js/render.js            layered-SVG resistor renderer + shared gradients/filters
js/audio.js             Web Audio sound effects + vibration
js/app.js               game loop, screens, settings, storage, SW registration
icons/                  icon.svg + 192/512/maskable/apple-touch PNGs
tests/core.test.js      unit + fuzz tests for the math (node --test)
tools/make-icons.cjs    dev-only: regenerates PNG icons from icon.svg
.nojekyll               tells GitHub Pages to serve files as-is
```

## Run locally

```sh
python3 -m http.server 8000        # then open http://localhost:8000
npm test                           # or: node --test tests/*.test.js
```

Service workers need `http://localhost` or HTTPS. Opening `index.html` directly from disk (`file://`) won't work.

## Publish on GitHub Pages

1. Push this repository to GitHub, with these files at the repository root.
2. On GitHub, open the repo and go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
4. Set **Branch** to `main` (or whichever branch holds the files) and **Folder** to `/ (root)`, then click **Save**.
5. Wait a minute or two. The site will be live at `https://<username>.github.io/<repo-name>/`.

All paths are relative, so the app works under that `/<repo-name>/` subpath without any changes.

**Shipping an update:** bump `VERSION` at the top of `sw.js` (e.g. `v1.0.1`) and push. Open copies of the app download the new version in the background and show an **Update now** button. Without the bump, installed copies keep serving the old cached files.

## Install it

**iPhone / iPad (Safari):** open the URL in Safari → tap **Share** (the square with an up arrow) → **Add to Home Screen** → **Add**. The app opens full screen from the home screen icon.

**Android (Chrome):** open the URL in Chrome → tap the **⋮** menu → **Install app** (or **Add to Home screen**), or tap the install banner if Chrome shows one → **Install**.

Open the app once while online. After that it works in airplane mode. Sound starts after your first tap, because mobile browsers block audio until then. On iPhone, the ring/silent switch also mutes it.

## Notes

- Values come from real E24 (4-band) and E96 (5-band) series, so you practice the values you'll actually meet.
- Answer choices are built from common misreads (wrong multiplier, swapped digits, a neighboring color, reading the multiplier as a third digit). The tests check that choices are never duplicated and that exactly one is correct.
- Vibration uses `navigator.vibrate`. Android supports it; iOS browsers don't, so on iPhone the setting does nothing.
