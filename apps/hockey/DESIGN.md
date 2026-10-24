# Hinge Hockey — design spec
1. **Mood:** Tron/synthwave arena. Black glass ice, neon tubes, everything emits light (additive `lighter` blending, layered strokes = bloom).
2. **Palette:** void `#03040A`, ice `#060A1C`→`#0B1030`, air-hole dots `#3A4BFF @18%`, rink tubes `#6B5BFF`, gate/crease `#FFFFFF`→player hue, P1 electric cyan `#19F0FF`, P2 hot magenta `#FF2BD6`, AI acid violet `#9D4BFF`, puck `#F2FF7A` core `#FFFFFF`, gold (win) `#FFD23F`.
3. **Type:** scoreboard digits = *Teko 600* (bold condensed) on split-flap tiles `#0B0E1E` with a hairline split; labels/banners = *Orbitron 900*, tracking +0.12em; fallback ui-rounded.
4. **Glass ice:** paddles & puck cast soft light pools + faded offset reflections; dot grid rotates with the rink.
5. **Puck:** stretched along velocity (motion blur), tapered additive light trail tinted by last hitter; hits = ring shockwave + sparks + pitch-by-speed blip + haptic.
6. **Goal beat:** time-scale 0.2 for 400 ms → net grid lights in scorer hue → rink floods scorer colour (50%→0 in 900 ms) → shake 14px decaying → horn → split-flap score flip (260 ms).
7. **Crease gate:** centre line is an energy gate (two pylons + flowing dashes); flashes + pulse ring each time the puck crosses.
8. **Unfold storyboard ("PLAYER 2 — JOINED", 2.6 s, 0.5 s reduced-motion):** 0 ms freeze, whoosh + rising sweep; 0–380 AI paddle dissolves into 90 violet motes sucked to the crease; 120–1100 rink CRACKS open along the crease (halves part ≤42px, white-hot fissure), while rotating 90° and re-forming 466×678→626×890 (goals to the short L/R ends).
9. 1000–1500 P2 half powers up line by line (walls → goal → crease arc → faceoff circles, 70 ms stagger, flicker-on); 1150 gate ignites; 1300 P2 paddle slams in (scale 2.4→1, magenta shockwave, thump + haptic).
10. 1350–2700 "PLAYER 2 — JOINED" sweeps across P2's half facing them (P1 sees "FACE-OFF MODE"); 2000 READY → 2600 GO, puck drops at the gate. Fold back = reverse: gate collapses, P2 paddle cross-fades magenta→violet, "AI TAKES OVER", 0.25× slow-mo ease back to play.
