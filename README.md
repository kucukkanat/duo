# Duo Lab

**Four things your iPhone can do now that it folds.** Duo Lab is a small PWA of experiments for **iPhone Duo**, Apple's passport-style foldable. Each experiment is built around one idea: unfolding the phone should change what the app *is*, not just make it bigger.

The hub (`index.html`) is "The Booklet". On the cover screen it looks like a closed, cloth-bound book that doubles as a contents list. Unfold the phone and the cover splits at the crease into a two-page spread.

## The apps

| | App | Closed (cover screen) | When you unfold |
|---|---|---|---|
| 01 | [Fold Booth](apps/booth/) | A viewfinder that shoots 4 frames | The photostrip slides out of the crease and develops, and your mirrored "twins" appear |
| 02 | [Sealed](apps/sealed/) | A wax-sealed envelope | The seal cracks and the letter pops up from the crease. The content travels in the link |
| 03 | [Hinge Hockey](apps/hockey/) | Air hockey against the AI | A friend's paddle drops in on the new half, face to face across the crease |
| 04 | [Liquid Fold](apps/liquid/) | Glowing liquid pooled on the small screen | It bursts through the crease. Tilt to pour it back |

## How fold detection works

Safari doesn't give a web page a hinge angle, Viewport Segments or a Device Posture API. It reports the fold **only as a viewport resize**. The cover screen is about 466×678 CSS px and the inner screen about 626×890. They have almost the same aspect ratio, so `shared/fold.js` keys on the **short side of the viewport**. On a touch device, a short side of at least 560px means open.

`fold.on(state => …)` fires on each change and sets `data-fold` / `data-crease` on `<html>`. On phones that can't fold, `fold.toggle()` simulates the change. The hub's **Unfold** button and every app's fold pill use it. `fold.count` holds the number of unfolds and is stored in `localStorage`. The hub shows it as the unfold counter.

## Layout

```
index.html, hub.css, hub.js   the hub ("The Booklet")
shared/                       fold.js (detection), kit.js (haptics, share, unlock, chrome), duo.css
apps/<name>/                  one self-contained experiment per folder
sw.js                         offline: cache-first shell, network-first apps
manifest.webmanifest, icons/  installable PWA (Share → Add to Home Screen)
```

There's no build step and no runtime dependencies. All paths are relative, so the site also works from a subpath such as `/duo/`.

## Run locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

On a desktop the hub shows a phone frame with a "Unfold the phone" button. Any narrow phone gets the simulated unfold. The service worker only registers over HTTPS.

## Deploy

`.github/workflows/pages.yml` publishes the repo root to **GitHub Pages**. It runs on pushes to `main` or `c-/**` and on manual dispatch, and stamps the service worker's cache version with the commit SHA. `configure-pages` runs with `enablement: true`, so the first run turns Pages on (source: GitHub Actions). `.nojekyll` keeps the files served exactly as they are.
