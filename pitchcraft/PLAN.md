# Pitchcraft — Technical Plan

An original, browser-based 3D football match simulator built with Three.js.
The goal is one polished, genuinely playable vertical slice: a single 7v7 match
against competent AI that feels responsive, physical and tactical.

## Scope

**In scope**
- One complete 5-minute match, kickoff to full time
- Two original teams (Harbour Vale, Ironmoor), 7v7, architecture ready for 11v11
- One stadium and pitch
- Human-controlled team vs. AI
- Kickoff, goals, throw-ins, corners, goal kicks, restarts
- Scoreboard, clock, pause, restart, full-time summary
- Keyboard-first controls, gamepad supported
- Runs directly in a modern desktop browser

**Explicitly out of scope**
- Multiple game modes, career, online play
- Licensed teams, players, kits, stadiums or audio
- A large content library

Everything visual and audible is generated procedurally at runtime. There are no
third-party art or sound assets in the repository, and nothing imitates a real
club, competition or player.

## Architecture

The single most important structural decision: **the simulation has no
dependency on Three.js or the DOM.** `src/sim`, `src/ai` and `src/match` are
plain JavaScript operating on numbers. The renderer observes simulation state
one-way and never writes back.

This buys three things that shaped the whole project:
1. A full match runs headless in Node in ~1.2 seconds (250x realtime), so
   balance can be measured over dozens of matches rather than guessed at.
2. Rules, physics and AI are unit-testable without a browser or a GPU.
3. Rendering can be dropped or replaced without touching gameplay.

```
src/
  core/       config, vector maths, deterministic RNG, event bus, perf monitor
  sim/        ball physics, player kinematics, kick model, contact resolution
  ai/         team AI (roles, zones, utility scoring), goalkeeper state machine
  match/      phases, clock, score, laws of the game, restarts
  control/    input abstraction (keyboard + gamepad), human player controller
  render/     scene, pitch, stadium, characters, animation, camera, effects
  audio/      WebAudio synthesis engine
  ui/         broadcast HUD, menus, stylesheet
  main.js     app shell: fixed-step loop + variable-rate render
tools/        headless match runner, balance diagnostics, browser capture
tests/        vitest suites (rules, physics, control, AI)
```

### Data flow

```
input ──> PlayerController ─┐
                            ├──> Match.step(dt) ──> World ──> Ball / Players
TeamAI, GoalkeeperAI ───────┘         │
                                      └──> EventBus ──> renderer, audio, HUD
```

`Match.step` is called at a fixed 1/120s. Rendering runs at display rate and
simply draws the latest state. This keeps physics and AI frame-rate independent
and makes matches reproducible from a seed.

## Key systems

**Ball physics.** A fully independent rigid body — never parented to a player.
Rolling friction is an exponential decay plus a constant stopping term, which is
solved in closed form so pass speeds can be *inverted* from a target distance.
Airborne motion adds gravity, linear drag and a Magnus term driven by spin.

**Possession.** There is no "ball attached to foot" state. Dribbling pushes the
ball toward a control point ahead of the player whose distance grows with pace,
so sprinting knocks the ball further ahead and is genuinely riskier. Receiving a
ball too fast to control produces a heavy touch that squirts loose.

**Team AI.** Deterministic and role-based, not a chase-the-ball loop. Each tick
classifies the team phase (attack / defend / loose ball), assigns every outfield
player exactly one job (carry, press, mark, cover, support, run, chase), converts
that job to a target point, and steers with teammate separation. The ball carrier
runs a separate utility model scoring every pass type against progression, lane
safety, receiver space and goal threat. The RNG only breaks ties and adds
execution error — never whether a decision is sensible.

**Goalkeeper.** An explicit state machine (position → dive → recover, plus rush
and distribute). Positioning follows a goal-line arc so angles narrow naturally.
Critically, a shot is projected onto *the keeper's own plane*, not the goal line,
because a keeper standing 6m off its line is not where the goal line is.

**Camera.** Tracks a damped point of interest that leads the ball and is pulled
toward the local centre of mass, from a real broadcast gantry position.

## Risk register

The highest-risk systems, identified up front and how each was handled:

| Risk | Mitigation | Outcome |
|---|---|---|
| Ball feel — the make-or-break system | Headless harness measuring possession, pass completion and dead-ball causes | Found and fixed 4 significant bugs invisible by eye |
| AI producing incoherent football | Role-based jobs + utility scoring, asserted in tests (no swarming, shape kept, correct goal) | Readable behaviour, verified |
| Match stalls / never reaching full time | Auto-take on every restart with a hard safety valve; clock runs through dead balls | Every seeded match reaches full time |
| Performance with 14 rigged characters | Shared geometry, instanced crowd, perf monitor | 342 draws, ~35k triangles |
| No art assets available | Everything procedural | No external dependencies |

## Development process

1. Build the simulation headless first, with no renderer at all.
2. Build measurement tools before tuning anything.
3. Get a full AI-vs-AI match running end to end.
4. Fix what the data says is broken, not what seems plausible.
5. Add rendering, then drive the real build in a browser and fix what that shows.
6. Repeat.

This order mattered: every significant gameplay bug in this project was found by
instrumentation, not by looking at the game. See `DESIGN_DECISIONS.md` for the
specifics.
