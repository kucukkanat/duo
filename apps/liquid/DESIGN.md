# Liquid Fold: design spec

1. **Material.** Particles splat additively into a half-float field. Two render targets hold (rgb·w, w) and (speed·w). The shading pass thresholds the field and takes the surface normal from the field gradient. The background is a soft bokeh-and-dot-grid gradient, and the shader refracts it by offsetting each sample by normal.xy × 22px. It also adds a Fresnel rim, a sharp Blinn specular (power 90) with a wide sheen (power 12), and a soft bloom read from field mipmaps (LOD 3–4).
2. **Light follows gravity.** The light comes from −g, the "up" direction, so the highlights slide around as you tilt.
3. **Speed tint.** Fast liquid is hotter and brighter, using a per-theme ramp. Lava fades to a dark crust where the liquid is slow.
4. **Palettes** (body, hot, crust/deep, background top → background bottom, glow):
   - Lava: #ff4a12, #ffd25a, #2a0703, #1a0604 → #040101, glow #ff5a1f
   - Mercury: #c8d0da, #ffffff, #4a5260, #12151b → #030405. Chrome environment reflection with metal = 1.
   - Ocean: #0a84ff, #4ff0ff, #02163f, #031228 → #01040b, glow #19b4ff
   - Aurora: #38ff9c, #c5a3ff, #2b1268, #0a0820 → #020108. Iridescence 0.6.
   - Neon: #ff2bd6, #00f0ff, #3a0050, #10031a → #000000. Glow 1.3.
5. **Crease wall.** A glass divider: a refractive bar with edge highlights and an accent halo. The gap ends are two glowing beads.
6. **Unfold storyboard.** The main case is the cover screen at 466×678 portrait opening to the inner screen at 890×626 landscape, with a vertical glass spine at x = W/2. When the open phone is held in portrait, or on simulated phones, the divider is horizontal and the liquid pours downward. Everything below is timed from t=0, when the fold event lands.
   - 0–600ms: the camera morphs from the old framing to the full spread, so the world visibly stretches and doubles. The liquid is remapped into the old half.
   - 0–260ms: the glass wall grows in from both ends toward the gap.
   - 280ms: the gap cracks open with an overshoot. A chromatic (RGB-split) flash fires at the gap, followed by 140 spray droplets. Gravity is pulled toward the new half at 2.4g, particles near the gap get a velocity kick, and the camera shakes (8px, decaying over 350ms). A whoosh and 6 glugs play, with a haptic tick.
   - 280–1300ms: gravity eases back to the tilt or puck direction. Glugs keep playing in proportion to the flow through the gap.
7. **Fold.** The open world maps into a 2× virtual world, and a piston sweeps the far half back over 900ms. The liquid squeezes through the gap and jets in from the edge, with a reverse whoosh. Any stragglers are pushed in, then the wall dissolves.
8. **Performance.** Two substeps per 60Hz frame using Clavet double-density relaxation on a spatial-hash grid. Particles drop by 12% while the EMA frame time stays above 20ms, with a floor of 900. After that, the render scale drops.
9. **Chrome.** UI is minimal glass: theme chips with live swatches, a red record dot with a ring countdown, a tilt puck on desktop, and a pulsing "Unfold →" hint on the cover screen.
10. **Reduced motion.** No camera morph, no shake, and half the spray.
