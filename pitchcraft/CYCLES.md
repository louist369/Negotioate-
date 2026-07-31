# Review Cycles

Twenty review-and-improvement cycles. Each one measured something, and most
found a real defect. Recorded here with the evidence, including the cycles that
found nothing and the one whose fix was rejected — negative results are the
point of doing this systematically.

Harnesses used:

```bash
npm test                          # 86 automated tests
node tools/headlessMatch.js 12    # symmetric balance over 12 AI-vs-AI matches
node tools/diagnose.js 8          # attribute every dead ball to its cause
node tools/audit.js 5             # anomaly sweep: stuck players, NaNs, overspeed
node tools/audit.js 5 --bot       # same, driving the real human control path
node tools/capture.js             # drive the built game in Chromium + screenshots
node tools/interact.js            # 23 browser interaction assertions
node tools/leakcheck.js 15        # restart the build repeatedly, watch for growth
node tools/hero.js                # one frame with shadow mapping enabled
```

---

## 1. The human control path had never been exercised

Every measurement up to this point came from AI-vs-AI matches. Added
`tools/botPlayer.js`, a scripted driver that goes through the real
`PlayerController` and `Action` interface, and `tools/audit.js`.

**Found:** goalkeeper dives were unclamped. The "get there in time" term was not
bounded, so a keeper stretching for a far corner launched sideways at ~17 m/s —
twice a sprint, and visibly a teleport.

**Fixed:** dive speed capped; reaching the ball is handled by the existing
bounded stretch. Max observed player speed 16.9 → 9.3 m/s.

## 2. Charged shots were silently cancelled

**Found:** on the frame the shoot key is released it is no longer "down", so if
any other kick key happened to be held, the single shared charge slot was
reassigned to that action and the shot never fired. Only 53% of
releases-with-ball produced a shot.

**Fixed:** each kick key carries its own charge. 100%.

## 3. The player's team defended a man short

**Found:** the human-controlled player was skipped by `driveOffBall` but still
received a job from `assignJobs`, so nobody pressed, marked or chased in his
place.

A controlled experiment (controller attached, AI still driving the selected
player) confirmed there was no integration bug — that configuration is fully
competitive — so this was specifically about the vacated job.

**Fixed:** jobs go only to AI-driven players. The human team's share of
possession in the final third went 5.5% → 10.7%, matching the AI baseline.

## 4. Aggression is a weak difficulty lever

**Found:** halving the opponent's tackle rate (2.2 → 0.8 attempts/sec) barely
moved scorelines. Measured over 20 matches, opponent tackle attempts fell 30 → 10
while goals stayed flat.

**Fixed:** difficulty also scales execution error and pace, which do decide
matches.

## 5. Difficulty made real, and switchable

Tiers apply to the opponent only — being let down by your own team-mates is not
a difficulty setting. Handicaps live on a separate multiplier so switching
levels repeatedly never compounds. Selectable in the pause menu and via
`?difficulty=`.

Full-strength side vs each tier, 20 matches:

| Opponent | Result | Score |
|---|---|---|
| easy | W20 D0 L0 | 3.15 – 0.20 |
| normal | W14 D3 L3 | 2.35 – 0.70 |
| hard | W9 D3 L8 | 1.25 – 1.30 |

## 6. Feet slid at walking pace

`DESIGN_DECISIONS.md` claimed feet could not slide because cadence was tied to
ground speed. Measuring it disproved the claim.

**Found:** cadence came from a frequency curve with the stride *length* left
uncontrolled — a 1.5 m/s walk produced a **1.36 m step**.

**Fixed:** cadence solved from a realistic step length. 0.94 m walking, 2.45 m
sprinting, 1.6–3.5 steps/second. Four tests assert the band; the doc no longer
overstates the claim.

## 7. The event bus leaked

**Found:** `emit` recorded every event into an array nothing ever drained.
Restarting the real build 20 times showed linear growth — 1859 entries after 10
restarts, 3829 after 20.

Everything else was flat: scene objects, geometries, programs, player entities
and handler counts all delta 0.

**Fixed:** recording is opt-in and bounded.

## 8. Draw calls

**Found:** every joint sphere shared both a material and a local space with the
limb hanging off it, so each was a separate draw call for no reason.

**Fixed:** shoulder+upper-arm, elbow+forearm+hand, knee+shin merged. A player
went from 24 meshes to 16; scene objects 705 → 593, draw calls 330 → **237
(−28%)** with no visual change.

## 9. Input was frame-rate dependent

**Found:** the simulation takes up to eight fixed steps inside one rendered
frame, and `wasPressed` stayed true for all of them. One tap of the switch key
produced 1 switch at 1 step/frame and **8 at 8 steps/frame** — pressing Q at a
low frame rate skipped through the whole squad. Tackle, skill, through-ball and
restart-take shared the flaw, some masked by cooldowns.

**Fixed:** edge actions consume once per rendered frame. Verified at 1, 2, 4 and
8 steps/frame: exactly one switch every time.

## 10. Corners created nothing

**Found:** over 12 matches **every** corner was cleared and not one produced a
shot. There was no set-piece positioning at all — players held normal shape and
the delivery went to a random point in the six-yard box.

**Fixed:** attackers take recognisable stations (near post, penalty spot, far
post, edge of the area, one held for the second ball), defenders pick them up
goal-side, and the delivery is aimed at an actual runner. ~10% of corners now
produce a shot, the real-football rate.

Also corrected a wrong claim in `KNOWN_ISSUES.md`: set-piece *frequencies* were
described as under-representative, but measured per five minutes they are close
to real football and in places high.

## 11. Browser interaction audit — no defects

23 assertions across camera modes, the WebAudio graph, pause/resume, the
difficulty picker, the human taking their own set piece, and play-again.
**23/23 pass, 0 console errors.** Confirms the camera never drops below the pitch
or climbs into the stand roof across a match.

## 12. Fatigue — no defect

Average outfield stamina falls 86% → 78% across five minutes, players are
exhausted 2.2% of the time, sprint is wanted 30.7% of the time. Subtle but real
for a short match.

## 13. Passes were being taken off the passer's foot

The previously reported "49% pass completion" was measured wrongly — it counted
the next possession event, which could be the passer regaining the ball.

**Found:** measured by *first toucher*, only 23% of passes reached a team-mate.
Attributing where along the pass the interception happened found the cause:
**73% happened within the first 10% of the pass**, a mean of 11 m from the
target. That is not interception; it is a defender beside the passer taking the
ball off his foot, because reach was a flat 1.5 m regardless of ball speed.

**Fixed:** reach scales with the ball's relative speed — you can only lunge so
far in the time available. Keepers exempt.

Ground-pass completion 27% → **51%**, overall 23% → 35%, and the mean fraction
of a pass completed before interception 13% → 33%.

## 14. A fix that was rejected

Through balls completed only 7%, so the AI was given a race check: only play the
pass if the intended receiver beats the nearest opponent to it.

It worked exactly as designed — completion rose to 43%, through-ball frequency
fell from 369 to 18 per 8 matches — **and goals collapsed from 2.38 to 0.88,
shots from 9.9 to 3.6.**

Through balls complete rarely and are still the main source of chances.
Completion rate is the wrong thing to optimise. The check was removed and the
result recorded.

## 15. Keeper audit — no defect

9.2 committed dives and 2.3 saves per match, a mean 2.98 m off the line, 51% of
distributions lost. Unremarkable for a keeper under pressure. The keeper reaches
12.5 m off its line when rushing a loose ball inside the box; `KEEPER.maxAdvance`
governs positional play only, not rushes, and going that far to claim a ball in
the area is correct.

## 16. The human could not finish

**Found:** projecting every shot ballistically from the moment of the strike,
human shots were on target 47% of the time against the AI's 68% — and from a
*closer* average range (11.6 m vs 13.2 m).

The AI picks a point inside the goal frame away from the keeper. The human's raw
input vector was instead used to skew the launch direction, so a shot from a wide
angle was dragged across the face of goal.

**Fixed:** player intent now selects a point *within the frame* — lateral input
moves the aim across the mouth, neutral input takes the assisted point — and the
launch direction tracks that target. Human shot accuracy 47% → **77%**, ahead of
the AI.

This is what finally produced a real difficulty curve. Scripted-bot results over
10 matches per tier:

| Tier | Before cycles 1–16 | After |
|---|---|---|
| easy | 0.30 – 0.70, W0 D2 L8 | **1.00 – 0.40, W6 D2 L2** |
| normal | 0.10 – 4.00, W0 D0 L10 | **0.70 – 1.50, W1 D3 L6** |
| hard | 0.40 – 3.20, W1 D1 L8 | **0.30 – 2.40, W0 D0 L10** |

The bot is deliberately crude — fixed reaction cadence, no lookahead, rough aim.
It now wins comfortably on easy, is competitive on normal and is beaten on hard,
which is the shape a difficulty curve should have.

## 17. Visual review

Fresh evidence captured from the current build. Goal netting, coloured crowd,
LED boards, celebration poses, confetti and the selection ring all read
correctly at broadcast distance. No new defects.

## 18. Performance

237 draw calls and ~34k triangles at the `low` tier, ~350 and ~180k at full
quality with the crowd as a single instanced draw. Still **unverified on real
hardware** — see `KNOWN_ISSUES.md`.

## 19. Full regression

86 tests, run three times, stable. Every harness re-run:

| Metric | Value |
|---|---|
| goals / match | 2.33 |
| shots / match | 8.75 |
| saves / match | 2.08 |
| corners / throw-ins / goal kicks | 0.67 / 2.83 / 1.83 |
| close control | 43.5% of open play |
| dead-ball share | 14.8% |
| anomalies (stuck, NaN, overspeed, escaped) | none |
| matches reaching full time | all |
| console errors in the built game | 0 |

## 20. Documentation

Every document reconciled against measurement, including correcting three claims
that turned out to be wrong: that feet could not slide, that set-piece
frequencies were under-representative, and the mis-measured pass completion
figure.

---

## What this process was worth

Twelve of twenty cycles found a real defect. Every one of them was invisible in a
screenshot and most were invisible in aggregate match statistics too — they were
found by measuring a specific mechanism and comparing it against what it should
be. Three of the cycles corrected claims in this project's own documentation, and
one rejected a fix that improved its target metric while making the game worse.

---

# Round two: ten cycles on physics and graphics

The first twenty cycles were run before anyone had played the game. Once
someone did, the verdict was two words long: *"the physics still feel childlike
and the graphics are obviously weak."* Both turned out to be correct, and both
turned out to have a single measurable cause rather than a long tail of small
ones.

## 21. Locomotion was not human

Compared every number in `PLAYER` against published athletic data instead of
against how it felt:

| | was | human | |
|---|---|---|---|
| acceleration | 26 m/s² | 6–8 | far too high |
| time to top speed | 0.32 s | 1.6–2.2 s | far too fast |
| deceleration | 34 m/s² | 6–9 | far too high |
| standing turn rate | 774 deg/s | 360–540 | too high |
| sprint top speed | 8.45 m/s | 9.5–10.5 | too low |

**Found:** a player reached full sprint in a third of a second and stopped dead
in a tenth. Nothing on the pitch had mass. This is the whole of "childlike" —
it is not an animation problem, it is that the character had no inertia.

**Fixed:** acceleration 8.6, deceleration 10.5, standing turn 8.7 rad/s
(≈500 deg/s) falling to 2.6 at a sprint, top sprint 9.7 m/s. Slightly at the
brisk end of the real band, because this is a game.

## 22. The pitch was a junior pitch

**Found:** 78 × 50 m with 6.8 × 2.3 m goals. A 1.82 m player stood 3.74 goal
widths tall against a real 4.02, and the six-yard box was 13 m wide — narrower
than `goalWidth + 2 × goalAreaDepth`, which is geometrically impossible on a
real pitch. Undersized goals are the fastest way for a scene to read as a
schools match no matter how it is lit.

**Fixed:** regulation 7.32 × 2.44 m goals, pitch to 88 × 57, and every marking
re-derived from the goal rather than from the pitch.

## 23. Every AI range constant was still calibrated for the old pitch

**Found:** goals dropped from 2.33 to 1.40 per match on the larger pitch. Press
radius, support radius, marking radius, spacing, pass range, through-ball lead
and shooting range had all been tuned against 78 × 50, so enlarging the pitch
made the game passive rather than expansive.

**Fixed:** all scaled with the pitch. Goals recovered to 2.40.

## 24. Conversion ran at 43%, then 50%

**Found:** a regulation goal is 7.7% wider and 6% taller than the one the
goalkeeper was tuned against, so the same keeper conceded far more. Shot
conversion hit 50% — one in two shots a goal.

**Fixed:** swept `KEEPER.baseSave` over 30-match samples at each value rather
than guessing:

| baseSave | goals | shots | conversion | saves |
|---|---|---|---|---|
| 1.02 | 2.03 | 6.23 | 33% | 2.33 |
| 1.08 | 1.93 | 6.50 | 30% | 2.40 |
| **1.14** | **1.77** | **6.30** | **28%** | **2.63** |
| 1.20 | 1.73 | 6.43 | 27% | 2.93 |

Took 1.14, plus the dive span and speed the wider goal geometrically requires.

## 25. Slower players could no longer win a loose ball

The defensive-shape test started failing on its *sample count* — it collects
samples only while someone is in possession, and it could no longer find
enough. That is the test doing its job.

**Found:** the ball was owned by a player for only 31.8% of live play, against
44.1% before the locomotion change. Attributed directly by re-running with the
old acceleration:

| | owned while live |
|---|---|
| current | 31.8% |
| old locomotion | 44.1% |
| + `minReachFraction` 0.75 | 36.9% |
| + `reachRadius` 1.7 | 41.7% |

**Fixed:** not by giving the acceleration back — that is the defect — but by
widening the control envelope, which is what a real footballer has. A standing
leg extension from the body centre is about 1.7 m, and the old 1.5 m with a
0.5 minimum reach fraction was simply ungenerous. Possession returned to 43.0%
with human acceleration intact.

## 26. Shadows were rendering correctly and were invisible

**Found:** probing the live scene showed 245 shadow casters, a 2048² shadow
map, and a turf that received. The shadows were there. They could not be seen
because the light rig was hemisphere 0.55 + fill 0.62 + rim 0.4 + ambient 0.7
under a key of 2.15 — removing the key still left roughly half the scene's
light, so a shadowed pixel was barely darker than a lit one.

This is the whole of "the graphics are weak." It was never a lack of
brightness; it was that there was no *contrast*, so nothing had form.

**Fixed:** ambient light removed entirely, hemisphere to 0.16, fill to 0.34,
key to 3.1 — which is only possible because of cycle 27.

## 27. Indirect light was a constant

**Found:** every material in the scene is a `MeshStandardMaterial` with no
environment map, so its indirect term was a flat constant and its specular
response collapsed to one highlight per light. That is what makes an untextured
Three.js scene look like plastic, and it cannot be fixed by adding lights.

**Fixed:** `src/render/environment.js` paints a procedural stadium surround —
sky above, floodlight banks at roof height, dark stands at the horizon, green
turf bounce below — and hands it to `PMREMGenerator`. Kits, boots, the ball and
the goal frames now sit in the light a real pitch sits in.

## 28. The turf was one flat polygon

**Found:** 60% of every frame was a single plane with a tiling blade texture
too fine to survive minification, plus mown stripes drawn as unlit white
overlay quads. Real mow stripes are the same grass leaning toward or away from
you: the light band is both brighter *and* glossier. A flat white overlay gets
the tint and misses the specular difference entirely, so they read as paint.

**Fixed:** a second, pitch-sized macro map injected into the compiled shader
alongside the tiling detail map. It carries stripes as both a tint and a
roughness shift, floodlight pooling, corner falloff, and wear at the goalmouths,
penalty spots and centre circle.

## 29. The crowd was television static

**Found:** the crowd palette was fully-saturated primaries at equal weight, so
at 40 m every spectator was as loud as every other and the eye found no
structure. A real crowd under floodlight is dark and desaturated.

**Fixed:** weighted palette — 62% muted, 28% team colours, 10% bright — plus
vertical aisles, per-row shading, clustered empty seats, shoulders on the
figures, and a scatter of phone screens that the new bloom pass catches. The
instanced front-row figures were re-palletted to match, since they sit directly
against the texture behind them.

## 30. Post-processing, and what it revealed

Added `src/render/post.js`: bloom, then a lift/gamma/gain grade with a vignette
and edge chromatic aberration, then tone mapping at the end of the chain so
bloom operates in linear space.

**Found immediately:** at a bloom threshold of 0.85 the painted pitch markings —
near-white at 0.94 opacity — crossed it and glowed like neon tubing. Raised to
1.02 so only the floodlight heads lift. The goal netting then read as a grey
smudge against the crowd, and was given the emissive a floodlit nylon net
actually has.

---

## What round two was worth

Two complaints, ten cycles, and in both cases the cause was a single number
rather than a missing feature. "Childlike" was an acceleration of 26 m/s².
"Weak" was an ambient light of 0.7. Neither was visible in a screenshot, an
aggregate match statistic, or the test suite — the first was found by comparing
the config against published human data, the second by probing the live scene
and discovering that the shadows had been rendering correctly all along.

The most useful single tool built this round was `tools/sweep.js`, after two
successive balance decisions were made on 14-match samples whose noise was
larger than the effect being measured.

---

# Round three: the players

One more play-test line: *"the players themselves look too beta."* Correct
again, and this time it was the thing every previous round had explicitly
deferred.

## 31. The rig was the problem, and it did not need an asset

**Found:** players were a rigid-segment rig — tapered cylinders with a sphere at
every joint. It never came apart, but a knee was two overlapping tubes with a
ball between them, not a bending surface. This had been the top entry in
`KNOWN_ISSUES.md` since the project started, on the stated grounds that a
skinned mesh needs hand-authored weights and a rigged humanoid to license.

That reasoning was wrong. For a body this stylised, weights that are a smooth
function of distance along a bone chain are both easier to reason about and more
predictable than painted ones, and they are about eighty lines of code.

**Fixed:** `src/render/character.js` is now a procedurally-generated
`SkinnedMesh` over an 18-bone skeleton. The body is described as cross-section
rings in bind space — position, elliptical radius, two bone influences, material
slot — swept into tubes. Skin weights blend across a band spanning each joint,
reaching an even split exactly at the joint and mirroring on the far side.

The bones carry the names the old rig's joint Groups did, so `animation.js` was
not touched. It still writes a rotation into `joints.legL.knee`; that rotation
now deforms a surface. Draw calls went *down* — seven material groups in one
geometry against sixteen separate meshes.

## 32. Four passes on proportion, judged from renders

Each of these was a render, a look, and a specific correction:

1. **Legs read as stilts.** Thighs too thin and shorts ending at the hip.
   Quadriceps mass up, shorts down to just above the knee, sock line raised.
2. **The head was sunk into the chest.** The torso capped to a *point* at neck
   height and the head sat on the resulting cone. The chest now tapers through a
   trapezius into an actual neck radius and the head section continues straight
   out of it — one surface, no cap. The shoulder joint also moved down from 94%
   to 84% of torso height, which is where a real shoulder is relative to C7.
3. **Sleeves came out black.** The sleeve's V was mapped entirely inside the
   shirt texture's dark yoke band. Remapped to start below it, so a sleeve is
   team colour with the accent trim at the cuff.
4. **The shirt was one flat block.** Stripes were drawn in the secondary colour
   at 0.55 alpha — against the primary, almost no contrast at all. Now a paired
   dark stripe with a thin accent pinstripe beside it.

## 33. A face, and then half of it removed again

Added a head map — eyes, brows, mouth — drawn white-on-skin so the material's own
colour still carries each player's skin tone, and one texture serves the whole
squad. Needed its own material slot: the head shares a skin tone with the arms
and legs but must not share their untextured material.

**Immediately wrong:** the head became a dark helmet. The map painted a hairline
*and* the hair mesh covered the crown — two dark masses stacked. The hair shell
was also wider than the skull it sat on. Hair pulled back to a scalp cap at
1.035× the head radius, painted hairline removed.

## 34. Celebrating players were leaving the stadium

**Found by the audit, not by looking:** 57 `player-out-of-world` anomalies over
12 matches. `stepGoal()` steps players directly rather than through
`world.step()`, so it skipped the world constraints entirely — and a celebrating
scorer runs in a straight line for three and a half seconds. Players were
reaching 11m beyond the goal line, inside the stand. Now zero.

## 35. The F3 overlay was lying

**Found:** the performance overlay reported "1 draw, 0k tris". `renderer.info`
resets on every `render()` call, and the composer makes several per frame — the
last of which is a single fullscreen quad. Since the whole point of that overlay
is to get a number back from a real GPU, a wrong one is worse than none.

**Fixed:** `info.autoReset = false` with a manual reset once per frame. Now
reports 239 draws / 34k triangles at the `low` tier.

## 36. Shadows were off on exactly the hardware that needed them

**Found:** shadows were disabled at the `low` quality tier — which is what phones
fall back to. With the ambient fill cut back in cycle 26, a shadowless render
looks *worse* than the old over-lit one, not cheaper: there is nothing left
explaining where the light comes from.

**Fixed:** shadows at every tier, with the saving taken in map resolution
(1024/1024/2048) and filter cost (`BasicShadowMap` vs `PCFSoftShadowMap`).

## 37. A leak check that could not tell lazy init from a leak

**Found:** the skinned mesh added a bounded 2-geometry delta over restarts, and
`leakcheck.js` failed on it. Measuring at 10 and again at 25 restarts gave the
same delta of 2 — a one-time lazy allocation, not a leak.

The tool already carried a hardcoded "one texture is allowed" allowance for
exactly this situation, which is a guess dressed as a threshold.

**Fixed:** the check now runs *two equal batches* of restarts and asserts only
that the second one adds nothing. Whatever initialises lazily has already done
so by the end of batch one, so a real leak is exactly "batch two also grew".
No allowances, and strictly stronger than what it replaced.

---

## What round three was worth

The headline change was one the project had been talking itself out of since the
first cycle, on a technical premise that turned out to be false. Everything after
it was iteration against renders — four passes on proportion, one on the face,
each fixing something a screenshot made obvious and no test could see.

The two defects found by instrumentation rather than by looking (celebrating
players leaving the stadium, and an overlay reporting one draw call) were both
invisible in every screenshot taken this round.
