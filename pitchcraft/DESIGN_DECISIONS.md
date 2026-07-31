# Design Decisions

Decisions worth recording, with the reasoning and — where it applies — the
measurement that drove them.

---

## 1. The simulation does not depend on Three.js

`src/sim`, `src/ai` and `src/match` import nothing from the renderer or the DOM.

This is the decision everything else rests on. A full 5-minute match runs
headless in Node in about 1.2 seconds — roughly 250x realtime. That made it
possible to run dozens of matches and measure aggregate behaviour, which is how
every significant gameplay bug in this project was actually found.

**Cost:** a small amount of glue in `render/scene.js` to mirror sim state onto
the scene graph each frame. Worth it many times over.

---

## 2. Fixed-timestep simulation, variable-rate rendering

`Match.step()` always advances by exactly 1/120s. The render loop accumulates
real frame time and drains it in fixed steps.

Physics, AI decisions and match outcomes are therefore identical regardless of
frame rate, and a seed reproduces a match exactly. The accumulator is capped
(`SIM.maxAccumulator`) so a stalled or backgrounded tab drops its backlog instead
of trying to catch up on thousands of steps at once.

---

## 3. The ball is never attached to a player

There is no "carrying" state where the ball's transform is parented to a foot.
`Ball.owner` only marks who currently has close control; the ball is integrated
by the same physics every frame regardless.

Dribbling works by pushing the ball toward a control point in front of the
player, at a distance that grows with speed:

```
touchDist = lerp(0.55, 1.75, speedRatio)
```

Sprinting therefore knocks the ball further ahead and is genuinely riskier, and
deflections, interceptions and loose-ball scrambles all fall out of the physics
rather than needing special cases.

---

## 4. Pass speed is inverted from the rolling model, not guessed

The rolling integrator applies `v' = -k·v - c`, which has the closed form
`v(t) = (v0 + a)·e^{-kt} - a` where `a = c/k`. Integrating gives distance, and
that expression can be inverted with Newton's method to answer the question the
game actually needs: *what launch speed makes this pass arrive at that player at
a usable pace?*

This replaced a hand-tuned approximation that was badly wrong — a 5m pass was
launched hard enough to roll 20.5m and arrived at 12 m/s. Passing was
consequently the single largest source of dead-ball time in the match.

Pass **power** now modulates the *arrival* pace rather than acting as a blind
speed multiplier, so a firm pass is harder to intercept without sailing past its
target.

---

## 5. Lofted range is calibrated against the integrator, not modelled

`loftSpeed()` uses a lookup table built at module load by simulating a spread of
launch speeds through the same equations `Ball.step` uses, then interpolating.

The analytic approach was tried first and got the drag law wrong (it assumed
quadratic drag; the integrator applies linear damping), overshooting a 12m chip
by more than double. Rather than maintain two models that must agree, the table
is generated from the one that actually runs. It costs ~12k integration steps
once at startup and is exact by construction — including after any retune of the
ball constants.

---

## 6. Pitch markings are geometry, not texture

Lines are thin coplanar quads and ring segments rather than pixels painted into
a turf texture.

At broadcast camera distance a 14cm line on even a 2048px pitch texture is a
blurry ~4px smear. As geometry it stays crisp at any zoom for a few hundred
triangles. Turf detail is a separate small tiling texture, and the mown stripes
are translucent bands laid over it so they stay seamless at any pitch size.

---

## 7. Characters are a rigid-segment rig, not a skinned mesh

Each player is a jointed mannequin: tapered limb segments with spheres at every
joint so nothing visibly separates when limbs rotate. All 14 players share one
set of geometries; only materials differ.

**Why:** no rigged humanoid asset was available, and a skinned mesh with
hand-authored weights is a large amount of work for this slice. Joint spheres
give an acceptable stylised silhouette at gameplay distance.

**Cost, stated plainly:** limbs do not deform. Under close inspection the rig
reads as a mannequin rather than a person. This is the largest single gap between
this and a commercial football game's visuals, and it is recorded as the top
entry in `KNOWN_ISSUES.md`.

---

## 8. Animation is procedural, driven by simulation state

There are no animation clips. Every pose is computed from speed, heading change,
possession and action timers, then damped toward so state changes blend.

The run cycle's stride frequency is advanced in proportion to actual ground
speed, which means feet cannot slide — the classic artefact of playing a
fixed-speed clip on a variable-speed character. Turning speed, lean and stride
amplitude all key off velocity.

---

## 9. Assisted aiming that still rewards direction

Kicks blend the player's raw directional input with an assisted target:

```
direction = lerp(assistedTarget, rawInput, KICK.assistBlend*)
```

with 0.28 for passes and 0.42 for shots. Deliberate aiming always beats the
assist, but a roughly-correct input still finds a teammate. Candidates are
restricted to a cone around the input direction and scored on alignment, lane
safety and range, so the assist never picks something the player clearly wasn't
asking for.

---

## 10. Restarts auto-take, but the human can take their own

Any restart is played automatically after a short delay, with a hard safety valve
that force-takes it if the taker somehow cannot reach the ball. When the restart
belongs to the human's team they get a longer window and can aim and take it
themselves with a kick key.

**Why:** a match that can stall on a dead ball is broken, and that failure mode
is much worse than the loss of ceremony. This guarantees the match always
progresses to full time while still giving the player agency over their own set
pieces.

---

## 11. The match clock runs through dead balls

Originally the clock only advanced during open play. That meant a "5 minute"
match took an unbounded amount of simulated time to finish, and made full time
untestable. The clock now runs during restarts and celebrations, exactly as it
does in a real match, so a 5 minute match is 5 minutes.

---

## 12. Keeper saves are decided on commit, then honoured

When a keeper commits to a dive, the save is resolved probabilistically at that
moment from shot speed, the lateral distance it must cover and the time
available. Once the ball reaches the keeper's plane, a save that was decided
*will* be made, with the dive allowed to stretch (bounded by a plausible reach)
so the contact reads correctly.

The alternative — resolving purely on geometric intersection during the dive —
produced keepers who dove correctly and let the ball pass through their hands
about half the time, which looks broken regardless of how principled it is.

Crucially, the shot is projected onto the keeper's own x-plane rather than the
goal line. A keeper standing 6m off its line comparing its position against the
ball's crossing point *at the goal line* is comparing two different places; that
single confusion was letting almost everything in.

---

## 13. AI decisions come from game state, never from a language model

All AI is deterministic: role assignment, utility scoring, state machines. The
seeded RNG only breaks ties and injects execution error. The same seed always
produces the same match, which is what makes the balance work in
`TESTS.md` meaningful.

---

## 14. AI carriers must settle before releasing the ball

The carrier re-evaluates passing every 0.12s. Without a dwell requirement it
offloaded within a couple of frames of every touch: 41 passes per minute, and the
ball was under close control only 19% of open play — the game read as pinball.

A carrier now holds the ball for `AI.minCarryTime` before looking to release,
unless genuinely under pressure. Close control went from 19% to 43% of open play
and the pass rate fell to 30/min.

---

## 15. Everything is generated at runtime

Textures (turf, netting, crowd, LED boards, ball panels, shirt numbers), geometry
and audio are all produced in code. There is no asset pipeline, no loading
screen worth the name, and no third-party content in the repository.

Audio in particular is fully synthesised: the whistle is two detuned square
oscillators through a vibrato LFO, post strikes are inharmonic partials, and the
crowd is filtered noise whose gain and brightness are driven by a live
"excitement" value that match events push around.
