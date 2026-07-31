import { describe, it, expect } from 'vitest';
import { Match, Phase } from '../src/match/match.js';
import { PlayerController } from '../src/control/playerController.js';
import { Action } from '../src/control/input.js';
import { PlayerState, Player } from '../src/sim/player.js';
import { EV } from '../src/core/events.js';
import { SIM, PLAYER, PITCH, AI, HALF_LENGTH, HALF_WIDTH, TEAMS } from '../src/core/config.js';

const STEP = SIM.fixedStep;

/** Scriptable stand-in for InputManager — no DOM, fully deterministic. */
class FakeInput {
  constructor() {
    this.axis = { x: 0, z: 0 };
    this.held = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.frameId = 0;
  }
  move(x, z) {
    this.axis.x = x;
    this.axis.z = z;
  }
  press(a) {
    this.pressed.add(a);
    this.held.add(a);
  }
  hold(a) {
    this.held.add(a);
  }
  release(a) {
    this.held.delete(a);
    this.released.add(a);
  }
  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.frameId++;
  }
  poll() {}
  isDown(a) {
    return this.held.has(a);
  }
  wasPressed(a) {
    return this.pressed.has(a);
  }
  wasReleased(a) {
    return this.released.has(a);
  }
}

function makeControlledMatch(seed = 100) {
  const match = new Match({ seed, humanTeam: 0 });
  const input = new FakeInput();
  const controller = new PlayerController({
    input,
    teamId: 0,
    world: match.world,
    bus: match.bus,
  });
  match.attachHumanController(controller);
  return { match, input, controller };
}

function run(match, input, seconds, until = null) {
  const n = Math.ceil(seconds / STEP);
  for (let i = 0; i < n; i++) {
    match.step(STEP);
    input.endFrame();
    if (until && until(match)) return true;
  }
  return false;
}

function toPlay(match, input) {
  run(match, input, 8, (m) => m.phase === Phase.PLAY);
}

describe('player selection and switching', () => {
  it('starts controlling an outfield player', () => {
    const { controller } = makeControlledMatch();
    expect(controller.controlledPlayer).toBeTruthy();
    expect(controller.controlledPlayer.team).toBe(0);
    expect(controller.controlledPlayer.isKeeper).toBe(false);
  });

  it('switches to a different player on demand', () => {
    const { match, input, controller } = makeControlledMatch(101);
    toPlay(match, input);
    const before = controller.controlledPlayer;
    input.press(Action.SWITCH);
    match.step(STEP);
    input.endFrame();
    expect(controller.controlledPlayer).not.toBe(before);
    expect(controller.controlledPlayer.team).toBe(0);
  });

  it('switches toward the direction being pressed', () => {
    const { match, input, controller } = makeControlledMatch(102);
    toPlay(match, input);
    const before = controller.controlledPlayer;

    // Camera default: forward = -z, right = +x. Pressing "right" should pick a
    // team-mate on the +x side of the current player.
    input.move(0, 1);
    input.press(Action.SWITCH);
    match.step(STEP);
    input.endFrame();

    const after = controller.controlledPlayer;
    expect(after).not.toBe(before);
    expect(after.pos.x).toBeGreaterThan(before.pos.x - 1.5);
  });

  it('emits a switch event so the HUD and audio can react', () => {
    const { match, input, controller } = makeControlledMatch(103);
    toPlay(match, input);
    const events = [];
    match.bus.on(EV.SWITCH, (e) => events.push(e));
    input.press(Action.SWITCH);
    match.step(STEP);
    input.endFrame();
    expect(events.length).toBeGreaterThan(0);
    expect(events[events.length - 1].player).toBe(controller.controlledPlayer);
  });

  it('hands control to whichever team-mate wins the ball', () => {
    const { match, input, controller } = makeControlledMatch(104);
    toPlay(match, input);

    // Give the ball to a team-mate who is not currently controlled.
    const mate = match.world.teams[0].find((p) => p !== controller.controlledPlayer && !p.isKeeper);
    match.world.ball.owner = mate;
    mate.hasBall = true;
    match.world.ball.pos.x = mate.pos.x;
    match.world.ball.pos.z = mate.pos.z;

    match.step(STEP);
    input.endFrame();
    expect(controller.controlledPlayer).toBe(mate);
  });

  it('never leaves the human controlling a stumbling player', () => {
    const { match, input, controller } = makeControlledMatch(105);
    toPlay(match, input);
    const p = controller.controlledPlayer;
    p.stumble();
    match.step(STEP);
    input.endFrame();
    expect(controller.controlledPlayer).not.toBe(p);
  });
});

describe('movement feel', () => {
  /** Movement is being tested, not selection — hold control on one player. */
  const pin = (controller) => {
    controller.autoSwitch = () => {};
    return controller.controlledPlayer;
  };

  it('accelerates rather than snapping to full speed', () => {
    const { match, input, controller } = makeControlledMatch(106);
    toPlay(match, input);
    const p = pin(controller);
    p.vel.x = 0;
    p.vel.z = 0;

    input.move(1, 0);
    input.hold(Action.SPRINT);

    match.step(STEP);
    input.endFrame();
    const afterOneStep = p.speed;
    // One 1/120s step cannot produce anything close to top speed.
    expect(afterOneStep).toBeLessThan(PLAYER.sprintSpeed * 0.35);

    run(match, input, 2.0);
    expect(p.speed).toBeGreaterThan(PLAYER.runSpeed * 0.6);
  });

  it('takes time to reverse direction instead of teleporting momentum', () => {
    const { match, input, controller } = makeControlledMatch(107);
    toPlay(match, input);
    const p = pin(controller);

    input.move(1, 0);
    input.hold(Action.SPRINT);
    run(match, input, 1.5);
    const forwardHeading = p.heading;

    input.move(-1, 0);
    match.step(STEP);
    input.endFrame();
    // Heading cannot flip 180 degrees in a single step.
    const delta = Math.abs(Math.atan2(Math.sin(p.heading - forwardHeading), Math.cos(p.heading - forwardHeading)));
    expect(delta).toBeLessThan(0.5);
  });

  it('drains stamina while sprinting and recovers at rest', () => {
    const { match, input, controller } = makeControlledMatch(108);
    toPlay(match, input);
    const p = pin(controller);
    p.stamina = 1;

    input.move(1, 0);
    input.hold(Action.SPRINT);
    run(match, input, 5);
    const drained = p.stamina;
    expect(drained).toBeLessThan(1);

    input.release(Action.SPRINT);
    input.move(0, 0);
    run(match, input, 6);
    expect(p.stamina).toBeGreaterThan(drained);
  });
});

describe('kicking through the controller', () => {
  function giveBall(match, controller) {
    const p = controller.controlledPlayer;
    const ball = match.world.ball;
    ball.frozen = false;
    ball.owner = p;
    p.hasBall = true;
    p.kickCooldown = 0;
    p.possessionLock = 0;
    ball.pos.x = p.pos.x + Math.sin(p.heading) * 0.6;
    ball.pos.z = p.pos.z + Math.cos(p.heading) * 0.6;
    ball.vel.x = 0;
    ball.vel.z = 0;
    ball.vel.y = 0;
    return p;
  }

  it('releases possession and sends the ball away on a pass', () => {
    const { match, input, controller } = makeControlledMatch(109);
    toPlay(match, input);
    const p = giveBall(match, controller);
    const ball = match.world.ball;

    const passes = [];
    match.bus.on(EV.PASS, (e) => passes.push(e));

    input.move(1, 0);
    input.hold(Action.PASS);
    match.step(STEP);
    input.endFrame();
    input.release(Action.PASS);
    match.step(STEP);
    input.endFrame();

    expect(passes.length).toBe(1);
    expect(ball.owner).toBeNull();
    expect(p.hasBall).toBe(false);
    expect(Math.hypot(ball.vel.x, ball.vel.z)).toBeGreaterThan(4);
  });

  it('sends a shot toward the goal the player is attacking', () => {
    const { match, input, controller } = makeControlledMatch(110);
    toPlay(match, input);
    const p = giveBall(match, controller);
    const ball = match.world.ball;

    const shots = [];
    match.bus.on(EV.SHOT, (e) => shots.push(e));

    input.move(1, 0);
    input.hold(Action.SHOOT);
    run(match, input, 0.5);
    input.release(Action.SHOOT);
    match.step(STEP);
    input.endFrame();

    expect(shots.length).toBe(1);
    // Ball must travel toward the attacked goal, not the player's own.
    expect(Math.sign(ball.vel.x)).toBe(p.attackDir);
    expect(match.stats[0].shots).toBeGreaterThan(0);
  });

  it('builds power while the shoot key is held', () => {
    const { match, input, controller } = makeControlledMatch(111);
    toPlay(match, input);
    giveBall(match, controller);

    input.hold(Action.SHOOT);
    match.step(STEP);
    input.endFrame();
    const early = controller.charge;
    run(match, input, 0.6);
    expect(controller.charge).toBeGreaterThan(early);
    expect(controller.charge).toBeLessThanOrEqual(1);
  });

  it('gives a lofted pass genuine height', () => {
    const { match, input, controller } = makeControlledMatch(112);
    toPlay(match, input);
    giveBall(match, controller);
    const ball = match.world.ball;

    input.move(1, 0);
    input.hold(Action.LOFT);
    run(match, input, 0.6);
    input.release(Action.LOFT);
    match.step(STEP);
    input.endFrame();

    expect(ball.vel.y).toBeGreaterThan(3);
  });

  it('starts a tackle when pressing tackle near a loose ball', () => {
    const { match, input, controller } = makeControlledMatch(113);
    toPlay(match, input);
    const p = controller.controlledPlayer;
    const ball = match.world.ball;

    ball.frozen = false;
    ball.owner = null;
    p.hasBall = false;
    p.tackleCooldown = 0;
    p.setState(PlayerState.IDLE);
    ball.pos.x = p.pos.x + 1.2;
    ball.pos.z = p.pos.z;

    input.press(Action.TACKLE);
    match.step(STEP);
    input.endFrame();

    expect(p.state).toBe(PlayerState.TACKLE);
  });

  it('knocks the ball away from the feet on a skill move', () => {
    const { match, input, controller } = makeControlledMatch(114);
    toPlay(match, input);
    giveBall(match, controller);
    const ball = match.world.ball;

    input.move(0, 1);
    input.press(Action.SKILL);
    match.step(STEP);
    input.endFrame();

    expect(ball.owner).toBeNull();
    expect(Math.hypot(ball.vel.x, ball.vel.z)).toBeGreaterThan(3);
  });
});

describe('AI behaviour', () => {
  it('keeps teams attacking their own target goal', () => {
    const match = new Match({ seed: 200 });
    run(match, { endFrame() {} }, 0);
    // Simulate and record which goal each team's shots head toward.
    const shotDirs = [[], []];
    match.bus.on(EV.SHOT, (e) => {
      shotDirs[e.player.team].push(Math.sign(e.target.x));
    });
    for (let i = 0; i < 120 * 240; i++) {
      match.step(STEP);
      if (match.isOver) break;
    }
    for (let t = 0; t < 2; t++) {
      for (const d of shotDirs[t]) expect(d).toBe(TEAMS[t].attackDir);
    }
  });

  it('does not let the whole team swarm the ball', () => {
    const match = new Match({ seed: 201 });
    for (let i = 0; i < 8 * 120; i++) match.step(STEP);

    let worstBallSeekers = 0;
    let worstCrowd = 0;
    let crowdedSamples = 0;
    let samples = 0;

    for (let i = 0; i < 120 * 120; i++) {
      match.step(STEP);
      if (match.isOver) break;
      if (i % 60) continue;
      // Open play only, and away from the goalmouth: a packed penalty area
      // during a scramble is correct football, not a swarming bug.
      if (match.phase !== Phase.PLAY) continue;
      const b = match.world.ball;
      if (Math.abs(b.pos.x) > HALF_LENGTH - PITCH.penaltyAreaDepth) continue;

      samples++;
      for (let t = 0; t < 2; t++) {
        // The behavioural test: how many players are actually going for the
        // ball. Geometric proximity alone is a poor proxy, because with ~6.5m
        // mutual spacing several players can legitimately be near the ball
        // while doing entirely different jobs.
        const jobs = match.teamAI[t].assignments;
        const seekers = match.world.teams[t].filter(
          (p) => !p.isKeeper && (jobs.get(p) === 'press' || jobs.get(p) === 'chase')
        ).length;
        worstBallSeekers = Math.max(worstBallSeekers, seekers);

        const near = match.world.teams[t].filter(
          (p) => !p.isKeeper && Math.hypot(p.pos.x - b.pos.x, p.pos.z - b.pos.z) < 7
        ).length;
        worstCrowd = Math.max(worstCrowd, near);
        if (near > 4) crowdedSamples++;
      }
    }

    expect(samples).toBeGreaterThan(100);
    // At most two players ever commit to the ball at once.
    expect(worstBallSeekers).toBeLessThanOrEqual(AI.pressersMax);
    // The whole outfield unit is never around the ball...
    expect(worstCrowd).toBeLessThan(6);
    // ...and even five-in-a-circle is a rare transition artefact.
    expect(crowdedSamples / (samples * 2)).toBeLessThan(0.05);
  });

  it('keeps a defensive shape rather than abandoning its own half', () => {
    // Sampled densely across several seeds: a single match gives too few
    // in-possession samples for the ratio to mean anything.
    let withCover = 0;
    let samples = 0;

    for (const seed of [202, 212, 222]) {
      const match = new Match({ seed });
      for (let i = 0; i < 20 * 120; i++) match.step(STEP);

      for (let i = 0; i < 120 * 120; i++) {
        match.step(STEP);
        if (match.isOver) break;
        if (i % 60) continue;
        const b = match.world.ball;
        const owner = b.owner;
        // Only meaningful while someone is actually in possession: the
        // attacking side is supposed to have players ahead of the ball.
        if (!owner) continue;
        samples++;
        const t = 1 - owner.team;
        const dir = TEAMS[t].attackDir;
        const goalSide = match.world.teams[t].filter(
          (p) => !p.isKeeper && (p.pos.x - b.pos.x) * dir < 0
        ).length;
        if (goalSide >= 1) withCover++;
      }
    }

    expect(samples).toBeGreaterThan(200);
    // The defending side should essentially always keep cover goal-side.
    expect(withCover / samples).toBeGreaterThan(0.9);
  });

  it('returns players to valid positions after a restart', () => {
    const match = new Match({ seed: 203 });
    for (let i = 0; i < 60 * 120; i++) match.step(STEP);
    match.resetMatch(204);
    for (let i = 0; i < 6 * 120; i++) match.step(STEP);

    for (const p of match.world.players) {
      expect(Math.abs(p.pos.x)).toBeLessThan(HALF_LENGTH + 6);
      expect(Math.abs(p.pos.z)).toBeLessThan(HALF_WIDTH + 6);
    }
  });

  it('produces goals over a full match without human input', () => {
    // Both sides fully AI-controlled: the match must actually produce football.
    let totalGoals = 0;
    let shots = 0;
    for (const seed of [301, 302, 303]) {
      const match = new Match({ seed });
      match.bus.on(EV.SHOT, () => shots++);
      match.bus.on(EV.GOAL, () => totalGoals++);
      for (let i = 0; i < 120 * 400; i++) {
        match.step(STEP);
        if (match.isOver) break;
      }
      expect(match.isOver).toBe(true);
    }
    expect(shots).toBeGreaterThan(6);
    expect(totalGoals).toBeGreaterThan(0);
  });
});

describe('animation locomotion', () => {
  /**
   * Measure metres travelled per foot-step at a fixed speed. A step is half a
   * gait cycle (PI of `anim.cycle`).
   */
  function stepLengthAt(speed) {
    const p = new Player({ team: 0, role: 'CM', index: 1, attackDir: 1 });
    const dt = 1 / 120;
    const frames = 900;
    let cycleAccum = 0;
    for (let i = 0; i < frames; i++) {
      p.vel.x = speed;
      p.vel.z = 0;
      const before = p.anim.cycle;
      p.updateAnim(dt);
      let d = p.anim.cycle - before;
      if (d < 0) d += Math.PI * 4; // wrapped
      cycleAccum += d;
    }
    const seconds = frames * dt;
    const steps = cycleAccum / Math.PI;
    return { metresPerStep: (speed * seconds) / steps, stepsPerSecond: steps / seconds };
  }

  it('keeps stride length in a human range at every pace', () => {
    // Regression: cadence used to be driven by a frequency curve with the stride
    // length left uncontrolled, which produced a 1.36m step at a 1.5m/s walk —
    // i.e. visibly sliding feet.
    for (const speed of [1.5, 3.0, 4.5, 6.35, 8.45]) {
      const { metresPerStep } = stepLengthAt(speed);
      expect(metresPerStep).toBeGreaterThan(0.55);
      expect(metresPerStep).toBeLessThan(2.6);
    }
  });

  it('lengthens the stride as speed rises', () => {
    const walk = stepLengthAt(1.5).metresPerStep;
    const jog = stepLengthAt(4.5).metresPerStep;
    const sprint = stepLengthAt(8.45).metresPerStep;
    expect(walk).toBeLessThan(jog);
    expect(jog).toBeLessThan(sprint);
  });

  it('keeps cadence within a plausible band', () => {
    for (const speed of [1.5, 4.5, 8.45]) {
      const { stepsPerSecond } = stepLengthAt(speed);
      expect(stepsPerSecond).toBeGreaterThan(1.2);
      expect(stepsPerSecond).toBeLessThan(4.5);
    }
  });

  it('keeps a stationary player idle animation alive', () => {
    const p = new Player({ team: 0, role: 'CM', index: 1, attackDir: 1 });
    const before = p.anim.cycle;
    for (let i = 0; i < 120; i++) {
      p.vel.x = 0;
      p.vel.z = 0;
      p.updateAnim(1 / 120);
    }
    expect(p.anim.cycle).not.toBe(before);
  });
});

describe('frame-rate independence of input', () => {
  /**
   * The simulation runs at a fixed step and may take several steps inside one
   * rendered frame. `wasPressed` stays true for all of them, so an edge-triggered
   * action must be consumed once per frame or it fires once per sub-step.
   */
  function manualSwitchesFor(stepsPerFrame) {
    const { match, input, controller } = makeControlledMatch(9001);
    toPlay(match, input);

    let manual = 0;
    const orig = controller.manualSwitch.bind(controller);
    controller.manualSwitch = (axis) => {
      manual++;
      orig(axis);
    };

    const TOTAL = 24;
    input.press(Action.SWITCH);
    let done = 0;
    while (done < TOTAL) {
      const n = Math.min(stepsPerFrame, TOTAL - done);
      for (let s = 0; s < n; s++) match.step(STEP);
      input.endFrame();
      done += n;
    }
    return manual;
  }

  it('fires a switch exactly once per press at any frame rate', () => {
    // Regression: at 8 sub-steps per frame a single tap produced 8 switches,
    // so pressing Q at a low frame rate skipped through the whole squad.
    for (const stepsPerFrame of [1, 2, 4, 8]) {
      expect(manualSwitchesFor(stepsPerFrame)).toBe(1);
    }
  });

  it('fires a tackle exactly once per press at any frame rate', () => {
    for (const stepsPerFrame of [1, 4, 8]) {
      const { match, input, controller } = makeControlledMatch(9002);
      toPlay(match, input);
      const p = controller.controlledPlayer;
      const ball = match.world.ball;
      ball.frozen = false;
      ball.owner = null;
      p.tackleCooldown = 0;
      p.setState(PlayerState.IDLE);
      ball.pos.x = p.pos.x + 1.2;
      ball.pos.z = p.pos.z;

      let attempts = 0;
      match.bus.on(EV.TACKLE, (e) => {
        if (e.attempt) attempts++;
      });

      input.press(Action.TACKLE);
      for (let s = 0; s < stepsPerFrame; s++) match.step(STEP);
      input.endFrame();

      expect(attempts).toBe(1);
    }
  });
});
