# Tests & Measured Results

Three layers of verification: unit/integration tests in Node, statistical
balance measurement over many headless matches, and driving the real build in a
browser.

```bash
npm test                    # 71 automated tests
node tools/headlessMatch.js 10   # balance over 10 full AI-vs-AI matches
node tools/diagnose.js 6         # attribute every dead ball to its cause
node tools/capture.js            # drive the built game in Chromium, screenshot
node tools/closeup.js            # fixed-camera inspection shots
```

---

## 1. Automated tests — 71 passing

```
Test Files  3 passed (3)
     Tests  71 passed (71)
  Duration  ~11s
```

### `tests/rules.test.js` (25) — laws of the game

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

### `tests/control.test.js` (20) — controls and AI

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
| No swarming | never more than 4 of 6 outfield players within 7m of the ball |
| Defensive shape | defending side keeps cover goal-side of the ball in >90% of samples |
| Valid positions after restart | all players on the pitch after a reset |
| Match produces football | 3 full AI matches: shots taken, goals scored, all reach full time |

---

## 2. Balance — 10 full AI-vs-AI matches

`node tools/headlessMatch.js 10`

```
goals/match       2.90
shots/match      11.40
saves/match       2.70
corners/match     0.90
throw-ins/match   1.00
goal kicks/match  1.00
tackles won/match 25.80
passes/match     153.30
all finished      true
sim speed         260x realtime
```

Every match reached full time. Shot conversion is ~25%, and roughly 2.7 saves
plus 0.5 woodwork strikes per match — the keeper is a real obstacle rather than
a formality.

### Ball-state distribution

`in open play` measured across 4 full matches:

| State | Share |
|---|---|
| Under close control | **43.3%** |
| Loose or pass in flight | 42.6% |
| Dead ball / restart / celebration | 14.1% |

### Tempo

| Metric | Value |
|---|---|
| Passes per minute (both teams) | 29.5 |
| Average time in close control per possession | 0.59s |
| Pass mix | 90 ground / 47 through / 15 lofted / 1.5 clearances |
| Restarts taken per match | 8.8 |

### Dead-ball causes

`node tools/diagnose.js 6` attributes every dead ball to the action that caused
it. Total is now ~2.3 per match, down from 24 before the pass and touch fixes:

```
0.33  goalKick <- loft
0.33  throwIn  <- pass
0.17  corner   <- clear
0.17  goalKick <- through
0.17  throwIn  <- loft
0.17  throwIn  <- shot
```

### Shot outcomes per match

```
3.17  goal
1.33  parried
1.00  caught
0.50  post / crossbar
```

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
