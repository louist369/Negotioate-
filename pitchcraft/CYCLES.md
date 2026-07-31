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
