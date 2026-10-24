# Sealed — design spec

1. **Mood.** A premium stationery card made of cotton paper, letterpress and real wax. The cover screen is a moody desk lit by a warm lamp, and the inside is a bright, tactile pop-up.
2. **Type.** Google Fonts with system fallbacks:
   - Headlines use *Fraunces* (opsz 144, italic 600; 900 for Party).
   - The message is handwritten ink in *Caveat* 500.
   - The envelope script and the signature use *Pinyon Script*.
   - The UI uses system rounded type.
3. **Palettes** (wall / floor / ink / accent / envelope / liner):
   - **Birthday:** #FBEADF / #F6DCCB / #5E2338 / #E8577A / #F1E3CF / stripes #E8577A on #FFF4EC
   - **Love:** #FCE6E8 / #F7D3D8 / #6E1229 / #D7263D / #F4E0DE / hearts #F25C6E on #FFF1F2
   - **Congrats:** #FFF6E2 / #F4E5C0 / #4A3200 / #C9971A / #F2E9D3 / gold foil #D4A017 on #1F2A44
   - **Party:** #1A0F33 / #22143F / #FBEFFF / #FF4FD8 / #2A1C49 / neon #3EF0FF on #1A0F33
   - **Thank you:** #EDF2E4 / #E0E9D2 / #284425 / #E07A5F / #EEE8DA / botanical #6A9A5B on #F7F3EA
   - **Secret:** #0E1931 / #13213F / #ECE6FF / #B9A4FF / #1C2440 / stars #FFD36B on #0E1931
   - **Wax:** crimson #9E1B22, gold #B8862B, navy #1F3A68, forest #2F5D3A, plum #5B2A5E, onyx #26252B
4. **Paper.**
   - Paper uses an SVG feTurbulence fibre-noise layer (multiply, about 35%) plus low-frequency mottling.
   - The envelope has a deckled top flap with a patterned liner inside, which shows when the flap swings open.
   - The crease gets a highlight and shadow pair.
5. **Wax seal.**
   - An irregular, drippy SVG blob with a radial body gradient (light at the top left).
   - A stamped inner ring, and an initial debossed with an inner shadow (dark offset at the top left, light rim at the bottom right).
   - A glossy specular highlight, clipped to the blob, that slides with tilt or the pointer, and a soft contact shadow.
6. **Pop-ups.**
   - Each layer is cut paper: flat fills, a 1–2px coloured edge band in a darker tone of the layer, and a white core line.
   - The floor contact shadow scales with how far the layer stands (`scaleY(p)`, opacity 0.45·p).
   - At rest, a gentle idle sway of about ±1.5° with tilt parallax.
7. **Confetti** is paper bits: rectangles and circles that flip in 3D and fall with drag. **Shards** fall with gravity, spin and bounce once on the floor.
8. **Storyboard (unfold).** The start is the fold event or the drag reaching 100%. Times are relative to that start.
   - **0ms:** a crack sound and a haptic tick. Cracks race to full along jagged lines over 120ms.
   - **120ms:** a flash ring. 7 shards burst, then fall under gravity with spin over 900ms, plus wax crumbs on the canvas.
   - **250ms:** the top flap swings open in real 3D (rotateX 0→-178°, perspective 800px, 750ms, cubic-out), revealing the liner pattern. A paper sound plays.
   - **450ms:** the bottom half drops away and the desk fades (600ms).
   - **800–1500ms:** the pop-up layers rise from the crease, staggered 110ms apart, on an underdamped spring (k180, c13). Each layer plays a soft pop, and its shadows grow.
   - **1500ms:** the headline writes itself in ink at 45ms per letter, with a blur→sharp effect and an ink bleed.
   - **2200ms:** the message types in Caveat at about 36 characters a second, with a nib tick sound, followed by the signature.
   - **End:** a theme flourish (confetti, hearts, fireworks, or petals), then the CTA fades up.
9. **Close.** The text fades (200ms). The layers fold flat in reverse stagger (80ms apart). The flap closes (600ms). The broken seal is shown with a missing chunk, and "Reseal?" is offered. Resealing reverses the shards, followed by a wax "thunk".
10. **Cover idle.** The envelope breathes, tilting with deviceorientation after a tap (±7°). A pulsing halo around the seal invites a drag. Dragging cracks the seal progressively, with a haptic and a crackle every 10%.
