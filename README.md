# Humanized Ohm Meter

A mobile-first game for practicing resistor color codes. It's a static site with no backend and no build step. You can install it as an app on iOS and Android, and it works fully offline.

- A realistic resistor (shaded ceramic body with grain, glossy printed bands, metal leads) drops onto a bench mat. Read the bands and pick the value from 4 choices, or type it with a unit (mΩ, Ω, kΩ, MΩ). Typed answers also accept codes like `4k7`, `R47` and `2M2`.
- After every answer you get the full breakdown, for example: *Brown = 1, Black = 0, Red = ×100 → 1,000 Ω = 1 kΩ, Gold = ±5%*.
- Scoring: +100 per correct answer (+150 for 5-band), a streak bonus of up to +200, a time bonus in timer mode, and −50 per miss. The score never goes below 0.
- Settings: 4-band, 5-band or mixed; milli, kilo and mega ranges; which tolerance colors appear; timer mode; sound and volume; vibration; and color codes printed on the bands (helps with color-vision differences).
- All sounds are synthesized with the Web Audio API, so there are no audio files.
- High score, stats and settings are saved in `localStorage`.

## Real photos mode (beta)

Switch **Simulated / Real photos** on the Play screen to practice on actual photos of resistors from [Wikimedia Commons](https://commons.wikimedia.org/). Every label was checked by eye against the bands. Photos with an unreadable or ambiguous band order were left out. Each photo shows its author and license, and `photos/CREDITS.md` lists them all.

To add photos: put the downloaded Commons image in a folder, add an entry to `tools/photo-labels.json` (bands, optional crop/rotate, optional note), then run `python3 tools/build-photos.py tools/photo-labels.json <commons-meta.json> <image-folder>`. The photo list is fetched network-first, so new photos show up without bumping the app version.

## Find a part (resistors, capacitors, inductors)

The **Find** tab works for resistors, capacitors and inductors. Type the value you need (`1234`, `4k7`, `100n`, `4.7u`, `36u`, `4R7`) or drag the ruler. It shows the closest standard part (E12/E24/E96 for resistors, E6/E12/E24 for capacitors and inductors), then 2- and 3-part series/parallel combinations, fewest parts first, each with its error %. Capacitors combine the opposite way to resistors (they add in parallel), and the app handles that.

**My parts** keeps a list of what you own, separately for each kind of component. Search by digits (`47` finds 4.7, 47, 470 …), by a value (`4.7k`, `100n`), or by a capacitor code (`104`), or browse by range. One tap on a tolerance adds that part. You can set how many you have (empty means plenty), add a whole kit, and export or import the list as a small JSON file. In Find, choose **My parts** to get results using only your parts, never using more pieces than you own. The list is stored on the device (`localStorage`, key `hom.parts.v1`, well under 100 KB even for a full E96 set). Export it to back it up or move it to another phone.

## Structure

```
index.html              app shell (iOS meta tags, manifest link, screens)
manifest.webmanifest    PWA manifest (standalone, icons incl. maskable)
sw.js                   service worker: versioned precache, offline, update prompt
css/styles.css          all styles (dark bench-mat theme, safe areas, reduced motion)
js/core.js              pure resistor math, value formatting, options, answer parsing
js/finder.js            pure Find math: E-series, parsing, combinations (R, C, L)
js/parts.js             My parts storage: validate, add/remove, quantities, kits, export/import
js/find-ui.js           Find tab and My parts UI
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

**Shipping an update:** bump `VERSION` at the top of `sw.js` (e.g. `v1.0.1`) and push. Open copies of the app download the new version in the background and show an **Update now** button. Players can also tap **Settings → Check for updates**: it downloads the new version, saves it for offline use, and only switches over when they tap **Restart with the new version**. If they're offline or the server can't be reached, they get a message and keep playing the version they have. The app never reloads on its own. Without the bump, installed copies keep serving the old cached files.

## Install it

**iPhone / iPad (Safari):** open the URL in Safari → tap **Share** (the square with an up arrow) → **Add to Home Screen** → **Add**. The app opens full screen from the home screen icon.

**Android (Chrome):** open the URL in Chrome → tap the **⋮** menu → **Install app** (or **Add to Home screen**), or tap the install banner if Chrome shows one → **Install**.

Open the app once while online. After that it works in airplane mode. Sound starts after your first tap, because mobile browsers block audio until then. On iPhone, the ring/silent switch also mutes it.

## Notes

- Values come from real E24 (4-band) and E96 (5-band) series, so you practice the values you'll actually meet.
- Answer choices are built from common misreads (wrong multiplier, swapped digits, a neighboring color, reading the multiplier as a third digit). The tests check that choices are never duplicated and that exactly one is correct.
- Vibration uses `navigator.vibrate`. Android supports it; iOS browsers don't, so on iPhone the setting does nothing.
