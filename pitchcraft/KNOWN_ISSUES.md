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
All verification is automated. The tuning targets responsiveness and ball feel
via proxy metrics, but nobody has actually held the controls. Some of the feel
tuning will certainly be wrong.

---

## Moderate

### 4. Pass completion sits around 49%
Lower than real football (~80%). Carriers now hold the ball longer, which draws
more pressure and more tackles (59 tackle attempts per match), so more passes are
played under duress. The game is coherent and competitive, but scrappier than
top-level football.

**Fix:** reduce `AI.tackleRate`, or raise the pass utility threshold further so
carriers only release when the option is genuinely good.

### 5. Very few throw-ins and corners
About 1.0 throw-ins, 1.0 goal kicks and 0.9 corners per 5-minute match. This is
*under*-representative — an artefact of aggressively containing pass targets
inside the pitch to fix the opposite problem (24 dead balls per match). Play
flows well but set pieces are rare, so that code path gets little exercise in
normal play.

**Fix:** relax `containTarget` margins slightly, particularly for clearances,
which realistically *should* sometimes go out.

### 6. Restarts are taken automatically if the player waits
The human gets ~3.4s to take their own restart; after that the AI takes it. This
guarantees the match can never stall, but a player who wants to reposition first
will have it taken out from under them.

**Fix:** hold indefinitely for human restarts while showing a prompt, with the
auto-take reserved for genuine inactivity.

### 7. No offside
Deliberately omitted from this slice. The AI `runTarget` respects the last
defender so runs still look purposeful, but nothing is penalised.

### 8. Single half, no added time
`MATCH.halves` exists in config but only one period is implemented. No half-time,
no stoppage time, no ends swap.

### 9. Goalkeepers only dive laterally
`GoalkeeperAI` handles low and high shots and dives left/right, but there is no
distinct "tip over the bar" behaviour, and the keeper cannot come out and smother
at a player's feet in a genuine 1v1.

---

## Minor

### 10. Crowd figures are static in shape
The instanced crowd bobs vertically with excitement but has no arm or pose
variation, and the front-row instances sit on top of a crowd *texture* rather
than replacing it. It reads well at broadcast distance and poorly up close.

### 11. Ball spin is Y-axis only
`Ball.spin` is a scalar about the vertical axis driving a Magnus curve. There is
no backspin/topspin, so lofted balls do not dip or hold up.

### 12. No replays
Goals would benefit from a replay, and the deterministic seeded simulation makes
this genuinely straightforward to add — but it is not implemented.

### 13. Audio has no spatialisation
Everything is mono through a single master bus. A kick on the far touchline
sounds identical to one at the near post. `PannerNode` would fix this cheaply.

### 14. Tackling has no fouls or cards
Tackles either win the ball, or the tackler stumbles. There is no referee model,
no free kicks and no penalties — so a mistimed challenge in the box costs
nothing.

### 15. Bundle is a single ~604 kB chunk
Mostly Three.js. Fine for a desktop game served locally; would want code
splitting for a bandwidth-sensitive deployment.

### 16. Desktop only
No touch controls, and the HUD hides its control hints below 720px. It will run
on a tablet but is not playable on a phone.

---

## Verified working

For balance, these were checked and behave correctly:

- Every seeded match reaches full time; no stalls or soft locks
- Restart, then play a second full match — no state corruption or duplicated entities
- Same seed reproduces a match exactly
- No console errors or warnings in the production build
- All players and the ball stay finite and in bounds for a whole match
- Both teams always attack the correct goal
- Never more than 4 of 6 outfield players within 7m of the ball
