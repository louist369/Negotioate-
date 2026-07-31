# Tests & Measured Results

Three layers of verification: unit/integration tests in Node, statistical
balance measurement over many headless matches, and driving the real build in a
browser.

```bash
npm test                          # 86 automated tests
node tools/headlessMatch.js 12    # symmetric balance over 12 AI-vs-AI matches
node tools/diagnose.js 8          # attribute every dead ball to its cause
node tools/audit.js 5             # anomaly sweep: stuck players, NaNs, overspeed
node tools/audit.js 5 --bot       # same, driving the real human control path
node tools/capture.js             # drive the built game in Chromium + screenshots
node tools/interact.js            # 23 browser interaction assertions
node tools/leakcheck.js 15        # restart the build repeatedly, watch for growth
node tools/closeup.js             # fixed-camera inspection shots
node tools/hero.js                # one frame with shadow mapping enabled
```

`CYCLES.md` records the twenty review cycles these harnesses were built for,
including what each one found.

---

## 1. Automated tests — 86 passing

```
Test Files  3 passed (3)
     Tests  86 passed (86)
  Duration  ~39s
```

Run three times consecutively to check for flakiness in the statistical
assertions: stable at 86/86 every time.

### `tests/rules.test.js` (34) — laws, clock, statistics, difficulty

| Requirement | Covered by |
|---|---|
| Teams attack the correct goal | keeper placement, opposing attack directions, per-team goal award |
| Goals register correctly | goal awarded to the right team at each end; score increments |
| Goals are *not* awarded wrongly | ball wide of the post; ball over the crossbar |
| Kickoff reset | conceding team restarts, ball returned to the centre spot |
| Ball leaving play | throw-in awarded against the last toucher, spot on the touchline |
| Corners | defender putting it behind own line → corner to attackers, spot in the arc |
| Goal kicks | attacker putting it behind → goal kick, taken by the keeper |
| Restarts always resume | every restart type returns to open play (no stalls) |
| Restart spacing | opponents respect the clearance radius; no team-mate stands on the ball |
| Match clock | counts down; does not advance while paused |
| Match ending | full time fires once, clock stops, simulation halts |
| Restart without corruption | reset restores clean state, no duplicated players, ids stable |
| Repeat playability | two complete matches back to back |
| AI valid positions | all players finite and on the world for a whole match |
| No overlapping players | no two players closer than 0.2m at any sample |
| Determinism | same seed → identical match; different seeds → different match |
| Match statistics | shots, tackles and passes counted for both teams, not just the human; reset on a new match |
| Difficulty | scales the opponent only; progressive handicap; stable across repeated switches; measurably weaker opponent at `easy` |
| Event bus | no event log accumulates during play; recording is opt-in and bounded |

### `tests/physics.test.js` (26) — ball behaviour

| Requirement | Covered by |
|---|---|
| Ball comes to rest | rolling ball reaches exactly zero, no infinite creep |
| Momentum & direction | direction preserved while rolling |
| Lofted kicks work | **regression test** for a ball at rest having its lift zeroed |
| Bounce | successive bounce peaks strictly decrease |
| Speed clamp | launch cannot exceed the configured maximum |
| Pass calibration | 4/8/12/16/20m passes each arrive within ±1.2 m/s of target pace |
| Roll model agreement | closed-form roll distance matches the integrator |
| Loft calibration | 12/20/28/36m lofts land within 1.5m of target |
| Loft clears a defender | 24m loft apex above 2.2m |
| Goal geometry | ball across the line counts; wide/over does not |
| Out of play | only once the *whole* ball is past the line |
| Post & crossbar | both rebound and redirect momentum |
| Netting | ball is contained inside the goal |
| Lane safety | clear lane = 1, blocked lane < 0.35, off-lane opponent ignored |
| Pass containment | targets clamped inside the field of play |
| Kick types | lofted kick has real vertical velocity; ground pass has none |

### `tests/control.test.js` (26) — controls, animation and AI

| Requirement | Covered by |
|---|---|
| Player switching | manual switch changes player; directional switch picks toward input |
| Switch feedback | switch event emitted for HUD/audio |
| Auto-switching | control follows whoever wins the ball; never left on a stumbling player |
| Movement is not sliding | one step cannot reach top speed; 180° reversal takes time |
| Sprinting | stamina drains while sprinting, recovers at rest |
| Passing | possession released, ball sent away with real pace |
| Shooting | shot travels toward the goal the player attacks; stat recorded |
| Variable power | charge accumulates while the key is held |
| Lofted pass | genuine vertical velocity |
| Tackling | tackle state entered when pressing near the ball |
| Skill move | ball knocked off the foot, still physical |
| Correct goals | every AI shot in a full match aims at that team's target goal |
| No swarming | at most two players assigned a ball-seeking job; shape not collapsed |
| Defensive shape | defending side keeps cover goal-side of the ball in >90% of samples |
| Valid positions after restart | all players on the pitch after a reset |
| Match produces football | 3 full AI matches: shots taken, goals scored, all reach full time |
| Stride length | metres-per-step stays in a human band at every pace |
| Stride scaling | step length grows with speed; cadence 1.2-4.5 steps/s |
| Idle animation | a stationary player's cycle keeps advancing |
| Frame-rate independence | one keypress = one switch, and one tackle, at 1/2/4/8 sub-steps per frame |

---

## 2. Balance — 12 full AI-vs-AI matches

`node tools/headlessMatch.js 12`

Both sides pinned to the same tier. (A match created with a `humanTeam` gives
that side full-strength team-mates while the opponent is scaled by difficulty,
so an unpinned "balance" run would be comparing unequal teams.)

```
goals/match       2.33
shots/match       8.75
saves/match       2.08
corners/match     0.67
throw-ins/match   2.83
goal kicks/match  1.83
tackles won/match 20.17
passes/match    118.83
all finished      true
sim speed         205x realtime
```

Every match reached full time. Set-piece frequencies are close to real football
per five minutes (corners ~0.55, throw-ins ~2.2, goal kicks ~0.85).

### Anomaly sweep

`node tools/audit.js 5` scans every match for stuck players, non-finite
positions, impossible velocities, players leaving the world, a ball nobody
collects, and frozen animation state.

```
anomalies            none
close control        43.5% of open play
dead-ball share      14.8%
worst ball-idle      0.1s
max player speed     9.3 m/s   (sprint ceiling 8.45)
max ball speed      31.6 m/s
```

### Difficulty curve

A full-strength side against each tier, 20 matches each:

| Opponent | Record | Score |
|---|---|---|
| easy | W20 D0 L0 | 3.15 – 0.20 |
| normal | W14 D3 L3 | 2.35 – 0.70 |
| hard | W9 D3 L8 | 1.25 – 1.30 |

And the scripted bot driving the real human control path, 10 matches each:

| Tier | Record | Score |
|---|---|---|
| easy | W6 D2 L2 | 1.00 – 0.40 |
| normal | W1 D3 L6 | 0.70 – 1.50 |
| hard | W0 D0 L10 | 0.30 – 2.40 |

### Passing

Measured by *first toucher* — who actually got to the ball first — rather than
by the next possession event, which can be the passer regaining it.

| Pass type | Reaches a team-mate |
|---|---|
| Ground pass | 51% |
| Lofted | 23% |
| Through ball | 9% |
| All types | 35% |

### Resource stability

`node tools/leakcheck.js 15` restarts the real build in Chromium fifteen times
and compares before/after.

```
scene objects   0 growth
geometries      0 growth
shader programs 0 growth
player entities 0 growth
event handlers  0 growth
textures       +1  (one lazy allocation; constant at both 10 and 20 restarts)
event queue     0
```

### Browser interaction

`node tools/interact.js` — **23/23 assertions pass, 0 console errors**. Covers
camera mode switching and camera sanity over a match, the WebAudio graph and
every synthesised voice, pause/resume and clock freeze, the difficulty picker
(including that the player's own team-mates are never handicapped), the human
taking their own throw-in, and play-again resetting cleanly.

### Renderer cost

| Quality | Draw calls | Triangles |
|---|---|---|
| `low` (harness default) | 237 | ~34k |
| `medium` / `high` | ~350 | ~180k (crowd instances) |

---

## 3. Browser verification

`node tools/capture.js` loads the production build in Chromium, drives it with
real keyboard input, steps a complete match and captures evidence.

**Result: 0 console errors, 0 warnings.** Match reached full time with a valid
final state.

Screenshots captured in `screenshots/`:

| Shot | Content |
|---|---|
| `01-kickoff` | Kickoff, broadcast framing |
| `02-midfield` | Midfield play |
| `03-passing` | A passing sequence |
| `04-shot` | A shot |
| `05-save` | A goalkeeper save |
| `06-restart` | A restart |
| `07-goal` | A goal + celebration camera and confetti |
| `08-pause` | Pause screen with full controls |
| `09-fulltime` | Full time with match statistics |
| `10-closeup-player` | Character rig close-up |
| `11-goalmouth` | Goal frame, netting and keeper |
| `12-shape` | Team shape with cast shadows |

### Renderer cost

| Quality | Draw calls | Triangles |
|---|---|---|
| `low` (harness default) | 342 | ~35k |
| `medium` / `high` | ~350 | ~180k (crowd instances) |

---

## Honest limitations of this test evidence

**Frame rate has not been measured on real hardware.** This environment has no
GPU; Chromium runs on the SwiftShader software rasteriser, which reports ~4 fps
and says nothing useful about GPU performance. What *can* be stated is the work
submitted per frame — ~350 draw calls and ~180k triangles at full quality, with
the crowd as a single instanced draw — which is a modest load for any discrete
or integrated GPU of the last decade. The 60 fps target is therefore
**unverified on real hardware**, and is listed as such in `KNOWN_ISSUES.md`.

**No human play-testing.** All gameplay evidence comes from AI-vs-AI matches and
scripted input. Assertions about "feel" are backed by proxy metrics (close-control
share, pass tempo, acceleration curves) rather than by a person playing it.

**Balance is measured against AI opponents only.** A human player is likely to be
more efficient than the AI, so scorelines against a human will differ.
