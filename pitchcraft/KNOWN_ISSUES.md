# Known Issues & Limitations

Recorded honestly. Ordered by how much each affects the experience.

---

## Significant

### 1. Characters do not deform — the rig is a jointed mannequin
Players are built from rigid tapered segments with spheres at the joints
(`src/render/character.js`). At gameplay distance this reads acceptably, but in
close-up the limbs are visibly separate solids rather than a continuous body.

This is the largest single gap between Pitchcraft and a commercial football
game's visuals.

**Fix:** replace with a `SkinnedMesh` and a real bone hierarchy. The animation
layer already drives named joints, so `animation.js` would need almost no
change — the work is authoring the mesh and skin weights.

### 2. 60 fps is unverified on real hardware
This build has only ever run on a software rasteriser (no GPU in the build
environment), so no meaningful frame-rate figure exists. Draw calls (~350) and
triangle count (~180k at full quality) are modest, but that is an argument, not
a measurement.

**Fix:** run on a real GPU, profile, and adjust `GRAPHICS.crowdDensity` and
`shadowMapSize`. A `?quality=low|medium|high` switch already exists.

### 3. No human has played it
All verification is automated. A scripted bot now drives the real control path
end to end (`tools/botPlayer.js`), which caught several genuine control defects,
but a bot is not a player. Nobody has actually held the controls, so some of the
feel tuning will certainly be wrong.

---

## Moderate

### 4. Pass completion is 35% overall (51% for ground passes)
Still below real football (~80%). Measured by first toucher across 8 matches:
ground passes 51%, lofted 23%, through balls 9%.

Through balls are the outlier, but they are deliberately left alone: cycle 14
made the AI only play them when the receiver wins the race to the ball, which
raised completion to 43% and **halved the goals** — they complete rarely and are
still the main source of chances. See `CYCLES.md`.

**Fix:** the remaining gap is mostly pressing intensity. Lowering `AI.tackleRate`
was measured and does *not* move completion (flat 44-46% from 2.2 down to 0.8
attempts/sec), so the lever is elsewhere — most likely support positioning, so
the carrier has a genuinely safe option more often.

### 5. Restarts are taken automatically if the player waits
The human gets ~3.4s to take their own restart; after that the AI takes it. This
guarantees the match can never stall, but a player who wants to reposition first
will have it taken out from under them.

**Fix:** hold indefinitely for human restarts while showing a prompt, with the
auto-take reserved for genuine inactivity.

### 6. No offside
Deliberately omitted from this slice. The AI `runTarget` respects the last
defender so runs still look purposeful, but nothing is penalised.

### 7. Single half, no added time
`MATCH.halves` exists in config but only one period is implemented. No half-time,
no stoppage time, no ends swap.

### 8. Goalkeepers only dive laterally
`GoalkeeperAI` handles low and high shots and dives left/right, but there is no
distinct "tip over the bar" behaviour, and the keeper cannot come out and smother
at a player's feet in a genuine 1v1.

---

## Minor

### 9. Crowd figures are static in shape
The instanced crowd bobs vertically with excitement but has no arm or pose
variation, and the front-row instances sit on top of a crowd *texture* rather
than replacing it. It reads well at broadcast distance and poorly up close.

### 10. Ball spin is Y-axis only
`Ball.spin` is a scalar about the vertical axis driving a Magnus curve. There is
no backspin/topspin, so lofted balls do not dip or hold up.

### 11. No replays
Goals would benefit from a replay, and the deterministic seeded simulation makes
this genuinely straightforward to add — but it is not implemented.

### 12. Audio has no spatialisation
Everything is mono through a single master bus. A kick on the far touchline
sounds identical to one at the near post. `PannerNode` would fix this cheaply.

### 13. Tackling has no fouls or cards
Tackles either win the ball, or the tackler stumbles. There is no referee model,
no free kicks and no penalties — so a mistimed challenge in the box costs
nothing.

### 14. Bundle is a single ~610 kB chunk
Mostly Three.js. Fine for a desktop game served locally; would want code
splitting for a bandwidth-sensitive deployment.

### 15. Mobile is playable but unproven on real hardware
Touch controls exist and are verified in an emulated iPhone 13 landscape (21/21
checks): a floating analogue stick, six action buttons, a pause button, safe-area
insets and a rotate prompt. Quality drops to `medium` automatically.

What is *not* verified: how it feels or performs on an actual iPhone. The
emulator gives real touch events and the right viewport, but renders in software
at a device pixel ratio of 1 — a real phone runs at 3.

Known gaps: no haptics, no landscape-lock (iOS Safari cannot request it from a
web page), and the stick is fixed at 62px radius rather than scaling to screen
size.

---

## Verified working

Checked and behaving correctly:

- Every seeded match reaches full time; no stalls or soft locks
- Restart, then play a second full match — no state corruption or duplicated entities
- Same seed reproduces a match exactly
- No console errors or warnings in the production build
- No resource growth across 20 restarts of the real build (scene objects,
  geometries, shader programs, entities and event handlers all flat)
- All players and the ball stay finite and in bounds for a whole match; an
  anomaly sweep for stuck players, NaNs, overspeed and escaped balls finds none
- Both teams always attack the correct goal
- At most two players commit to the ball at once
- Edge-triggered input fires exactly once per press at any frame rate
- 23/23 browser interaction assertions pass (camera, audio, pause, difficulty,
  human set piece, play again)
