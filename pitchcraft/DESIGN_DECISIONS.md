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

## 7. Characters are a procedurally-generated skinned mesh

Each player is a single continuous `SkinnedMesh` over an 18-bone skeleton. The
mesh, the skeleton and the skin weights are all generated at runtime from the
same `DIM` table the geometry has always used, so there is still no art asset in
the build and no rigged humanoid to license.

The body is described as a list of cross-section rings in bind space — position,
elliptical radius, up to two bone influences, and a material slot — which a
`lathe()` helper sweeps into tubes. Skin weights blend across a band spanning
each joint, reaching an even split exactly at the joint and mirroring on the far
side. That band is the whole point: it is what makes a bent knee one continuous
surface instead of two pieces pivoting.

**What this replaced:** a rigid-segment rig — tapered limb segments with spheres
at every joint so nothing visibly separated when limbs rotated. It was cheap and
it held together, but every limb was a separate solid and a knee was two
overlapping tubes with a ball between them. At broadcast distance it passed;
anywhere closer it read as a mannequin, which is exactly what it was. That was
the top entry in `KNOWN_ISSUES.md` for the life of the project, and a play-tester
named it unprompted.

**Why it did not need an asset:** the reason originally given for the mannequin
was that a skinned mesh needs hand-authored weights. It does not, for a body this
stylised — weights that are a smooth function of distance along a bone chain are
both easier to reason about and more predictable than painted ones, and they are
about eighty lines of code.

**What made it a drop-in:** the bones are named exactly as the old rig's joint
Groups were, so `animation.js` was not touched by this change. It still writes a
rotation into `joints.legL.knee`; that rotation now deforms a surface instead of
moving a solid.

**Cost:** roughly 2.4k triangles a player against the old rig's ~1.6k, and one
skeleton each. Draw calls went *down* — seven material groups in one geometry
against sixteen separate meshes.

**What is still missing:** the face is a texture, not geometry. Fingers, hair
strands and kit folds do not exist. Those are the things that would need bought
art; the body no longer is.

---

## 8. Animation is procedural, driven by simulation state

There are no animation clips. Every pose is computed from speed, heading change,
possession and action timers, then damped toward so state changes blend.

Cadence is derived from a realistic step *length* rather than from a frequency
curve: `cadence = speed / stepLength`, with `stepLength` interpolated from 0.62m
at a walk to 2.45m at a sprint. That keeps the foot planted at every pace.

This was originally implemented as a frequency curve, and measuring it showed the
claim "feet cannot slide" was simply untrue at low speed — at a 1.5 m/s walk the
model produced a 1.36m step. Solving for step length instead gives 0.94m walking
and 2.45m sprinting, at 1.6-3.5 steps per second, which is human gait. Tests
assert the step length stays in that band across the whole speed range.

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

## 15. Event recording is opt-in

`EventBus.emit` originally appended every event to a `queue` array for tests and
debug tooling. Nothing drained it during play, so a running match accumulated
roughly 190 entries per simulated minute forever — a slow but unbounded leak,
found by restarting the real build 20 times and watching the queue grow linearly
to 3829 entries. Recording is now off by default and bounded when enabled.

---

## 16. Difficulty scales the opponent only

Difficulty tiers adjust the opposing team's pace, execution error, pressing
frequency, shooting willingness and keeper quality. The player's own AI
team-mates always play at full strength — being let down by your own side is not
a difficulty setting, it's a bug.

Aggression alone turned out to be a weak lever: halving the opponent's tackle
rate barely moved scorelines. The tiers that actually separate are execution
error and pace. Measured over 20 matches, a full-strength side beats `easy`
20-0-0, `normal` 14-3-3 and is level with `hard` at 9-3-8.

---

## 17. Everything is generated at runtime

Textures (turf, netting, crowd, LED boards, ball panels, shirt numbers), geometry
and audio are all produced in code. There is no asset pipeline, no loading
screen worth the name, and no third-party content in the repository.

Audio in particular is fully synthesised: the whistle is two detuned square
oscillators through a vibrato LFO, post strikes are inharmonic partials, and the
crowd is filtered noise whose gain and brightness are driven by a live
"excitement" value that match events push around.

## 18. Indirect light comes from an environment map, not from ambient

Every material in the scene is a `MeshStandardMaterial`. Without an environment
map, such a material's indirect term is a flat constant and its specular
response collapses to a single highlight per light — which is what makes an
untextured Three.js scene look like moulded plastic regardless of how many
lights are added.

The original rig compensated the only way a constant-ambient scene can: by
adding more of it. Hemisphere 0.55, fill 0.62, rim 0.4 and ambient 0.7, under a
key of 2.15. That produced a bright image with no form, and — measurably —
invisible shadows: removing the key still left roughly half the scene's light,
so a shadowed pixel was barely darker than a lit one. The shadow maps had been
rendering correctly the entire time.

`src/render/environment.js` paints a procedural stadium surround into an
equirectangular canvas and runs it through `PMREMGenerator`. With real indirect
light available, the constant fills come down to hemisphere 0.16 and fill 0.34,
ambient goes away entirely, and the key rises to 3.1. Shadows appear, and every
curved surface on a player gets a gradient across it instead of a flat wash.

Trade-off: one extra render target and a PMREM pass at startup. It is generated,
not loaded, so it costs nothing in the bundle.

## 19. Locomotion is set from athletic data, not from feel

`PLAYER.accel`, `decel` and the turn rates are taken from published human sprint
data rather than picked for responsiveness: 8.6 m/s² acceleration, ~1.6s to top
speed, ~500 deg/s standing turn falling to ~150 deg/s at a sprint.

The previous values were chosen to feel responsive and did — 26 m/s² put a
player at full sprint in 0.32 seconds. The result read as weightless, and the
one-line play-test verdict was "childlike." Nothing on the pitch had mass.

The cost is real and was measured: with human acceleration, players could no
longer reach loose balls, and possession fell from 44.1% of live play to 31.8%.
The fix was deliberately *not* to restore the acceleration, because the
acceleration is the thing that was wrong. It was to widen the control envelope
to match — a standing leg extension from the body centre is about 1.7 m, and the
old 1.5 m reach with a 0.5 minimum reach fraction was simply ungenerous about
what an arriving player can do. Possession returned to 43.0%.

The general form of this decision: when a physical constant is wrong, correct
the constant and pay for it elsewhere, rather than keeping the wrong constant
because the system was balanced around it.

## 20. Balance decisions are swept, not guessed

Two successive balance changes in round two were made on 14-match samples and
both produced non-monotone difficulty curves — the noise was larger than the
effect. At roughly 2.5 goals a match, a 30-match sample has a standard error on
goal margin of about 0.35, which is the same size as the entire easy-to-hard
difference the tiers are supposed to produce.

`tools/sweep.js` runs a parameter across a large fixed sample and prints the
resulting balance, and `tools/diffcheck.js` does the same for the difficulty
tiers. Nothing in `KEEPER` or `DIFFICULTY` is now changed without one of them.

The knock-on for the test suite: the difficulty test can no longer assert on
goal margin over six matches, because that measurement cannot distinguish the
tiers even when they are working. It asserts on opponent shot volume instead,
which is what the tiers directly control and which separates cleanly at a
sample size the suite can afford.
