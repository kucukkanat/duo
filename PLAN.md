# Duo Lab — plan

A PWA showcase of 4 mini apps for **iPhone Duo**, Apple's passport-style foldable (on sale since Oct 23, 2026).

## How we got here (3 iterations)

**1. Research** (3 parallel agents)
- **The device.** The cover screen is 5.4" and portrait, about 466×678 CSS px. The inner screen is 7.6" and landscape, about 890×626: it opens like a book, so the crease is a vertical spine at x = width/2. Unfolding is simply a resize from 466×678 to 890×626.
- **What Safari tells a page.** It exposes the fold *only as a viewport resize*. There are no Viewport Segments, no Device Posture API and no hinge angle.
- **What works in a tab or installed app.** WebGPU (on by default), camera and mic, motion sensors, Web Audio, Web Share with files, MediaRecorder and Wake Lock.
- **What doesn't.** There is no Vibration API, so haptics use the `<input switch>` trick. rAF is capped at about 60fps. Each sensor needs a tap first.

**2. Judging** (an independent critic agent scored 10 ideas on wow, shareability, Duo-specificity, feasibility and how well they degrade on ordinary phones)
- Killed: DJ, Snow Globe and Scream. The fold played no part in them.
- Merged Mirror Face, Comic and Holo into the Booth.
- Rule adopted: **the unfold must change what the app *is*, not just make it bigger.** It should develop, reveal, spill or invite something.

**3. Plan.** The four apps below cover four different areas: camera, a social link, multiplayer, and a GPU/sensor spectacle. Every app shares one fold module, `shared/fold.js`. On phones that can't fold, it gives them a **simulated unfold** button, because most people who open a shared link won't own a Duo.

## The apps

| App | Closed (cover screen) | The unfold moment | Share artifact |
|---|---|---|---|
| **Fold Booth** `apps/booth` | Viewfinder; shoots 4 frames | The photostrip slides out of the crease and develops. The second page reveals your mirrored "twins" (left-left / right-right) | PNG strip via Web Share |
| **Sealed** `apps/sealed` | A wax-sealed envelope: "don't open until…" | Unfolding breaks the seal and paper pop-up layers rise from the crease | Link with all content in the URL hash |
| **Hinge Hockey** `apps/hockey` | Air hockey against the AI | Mid-game, a friend's paddle drops in on the new half, face to face across the crease | Challenge link with the score to beat |
| **Liquid Fold** `apps/liquid` | Glowing liquid pooled on the small screen | The world doubles and the liquid bursts through the gap in the crease. Tilt to pour it back like an hourglass | 6-second video clip |

**Hub** (`index.html`): "The Booklet". On the cover screen it shows a closed book that says "Open me". Unfold and the cover splits at the crease to reveal the 4 apps as a two-page spread. It also shows an unfold counter, which proves the detection is real.

## Shared modules
- `shared/fold.js`: unfold detection. The phone counts as open when the short side of the viewport is at least 560px on a touch device. It also handles the simulated fold and the `data-fold` and `--crease-*` CSS hooks.
- `shared/kit.js`: the tap-to-unlock for sensors and audio, haptics, share for files and links, canvas recording, compressed URL-hash state, toasts, and the shared app chrome.
- `shared/duo.css`: base tokens, the crease guide, the chrome, buttons and toasts.

The site is static with no build step, so it can be hosted anywhere (GitHub Pages workflow included).
