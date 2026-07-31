# Tasks

Status of the vertical slice.

## Done

### Foundation
- [x] Engine-agnostic simulation core (no Three.js or DOM dependency)
- [x] Fixed-timestep loop with accumulator cap, variable-rate rendering
- [x] Deterministic seeded RNG throughout
- [x] Event bus decoupling sim from renderer, audio and UI
- [x] All tuning values centralised in `core/config.js`
- [x] Headless match runner and balance diagnostics

### Ball physics
- [x] Independent rigid body — never parented to a player
- [x] Rolling friction with a genuine rest state
- [x] Gravity, air drag, bounce with decreasing peaks
- [x] Magnus curve from spin
- [x] Ground passes, through balls, lofted trajectories, variable-power shots
- [x] Pass speed inverted from the rolling model (arrives at a target pace)
- [x] Loft range calibrated against the real integrator
- [x] Post, crossbar and net collisions
- [x] Player body deflections
- [x] Loose-ball contests and interception

### Player control
- [x] Acceleration, deceleration, momentum, reverse braking
- [x] Speed-dependent turn rate (the anti-slide model)
- [x] Sprinting with stamina drain and recovery
- [x] Directional dribbling with pace-dependent touch distance
- [x] Short pass, through ball, lofted pass, variable-power shooting
- [x] Tackling with committed lunge and duel resolution
- [x] Skill move (lateral knock-past)
- [x] Manual and automatic player switching
- [x] Assisted targeting that still rewards directional input
- [x] Camera-relative movement
- [x] Keyboard + gamepad input

### AI
- [x] Team phase classification (attack / defend / loose)
- [x] Role-based job assignment: carry, press, mark, cover, support, run, chase
- [x] Utility-scored pass selection over all pass types
- [x] Lane safety, receiver space and goal-threat scoring
- [x] Attacking runs respecting the last defender; width and depth held
- [x] Teammate separation so players don't occupy the same space
- [x] Selective pressing capped at two players
- [x] Marking, covering, transition recovery
- [x] Time-to-intercept solver for loose balls
- [x] Goalkeeper state machine: position, dive, save, catch/parry, recover, distribute
- [x] Keeper angle narrowing on a goal-line arc

### Match rules
- [x] Kickoff with correct positioning and taker
- [x] Goal detection, score, celebration, restart to conceding team
- [x] Throw-ins, corners, goal kicks with correct awarding
- [x] Restart clearance for opponents and team-mates
- [x] Human can take their own restarts; auto-take guarantees no stalls
- [x] Match clock, pause, full time, restart-and-play-again
- [x] Possession and match statistics

### Presentation
- [x] Pitch: tiling turf, mown stripes, geometry line markings
- [x] Goals with posts, crossbar and visible netting
- [x] Stadium: four raked stands, roofs, LED perimeter boards, floodlights
- [x] Two-tier crowd (textured deck + instanced figures) reacting to match events
- [x] Procedural humanoid players with team kits and shirt numbers
- [x] Procedural animation: run, sprint, turn, dribble, pass, shoot, tackle,
      receive, stumble, keeper dive, celebrate
- [x] Broadcast camera with damped interest tracking; close camera; goal cinematic
- [x] Contact shadows, cast shadows, ball trail, turf spray, impact sparks, confetti
- [x] Synthesised audio: kicks, post strikes, whistle, tackles, crowd bed,
      crowd reactions, goal roar, UI feedback
- [x] Broadcast HUD: score bug, clock, phase pill, radar, power meter, banners
- [x] Pause screen with full controls, full-time summary with statistics
- [x] Quality tiers (`?quality=low|medium|high`)

### Verification
- [x] 71 automated tests across rules, physics, control and AI
- [x] Balance measured over 10 full headless matches
- [x] Dead-ball cause attribution harness
- [x] Browser harness driving the production build, 0 console errors
- [x] All 12 required evidence screenshots captured
- [x] Documentation: PLAN, TASKS, TESTS, KNOWN_ISSUES, DESIGN_DECISIONS, README

---

## The five highest-value next improvements

In priority order, judged on effect on quality per unit of work.

### 1. Replace the character rig with a skinned mesh
The one change that would most close the gap to a commercial football game.
Limbs currently do not deform. The animation layer already drives named joints,
so the runtime work is small — the cost is authoring a skinned humanoid.

### 2. Play-test with a human and re-tune the feel
Every gameplay decision here was validated by proxy metrics. Acceleration,
turn rate, touch distance, assist strength and switching all need a person's
hands on them before they can be called good.

### 3. Profile on real hardware and lock in 60 fps
Draw calls and triangles are modest but unmeasured on a GPU. Profile, then set
sensible defaults for `crowdDensity` and `shadowMapSize` per quality tier, and
auto-select the tier from measured frame time.

### 4. Fouls, free kicks and penalties
Tackling currently has no downside beyond stumbling. A referee model would add
real tactical weight to defending, make the penalty area meaningful, and reuse
the restart machinery that already exists.

### 5. Goal replays
The simulation is deterministic and seeded, so recording and replaying the last
few seconds from a different camera is mostly a presentation task. It is the
single biggest "feels like a real broadcast" win available for the effort.

---

## Deliberately not done

Out of scope for a vertical slice, listed so the omissions are clearly choices:
offside, half-time and ends swap, multiple formations or tactics screens, career
or tournament modes, online multiplayer, player likenesses or licensed content,
touch/mobile controls.
