/**
 * Scripted human-input driver.
 *
 * The human control path had never been exercised under continuous, realistic
 * input — every measurement so far came from AI-vs-AI matches. This drives the
 * real `PlayerController` through the real `Action` interface, so it tests
 * exactly the code a player's keyboard reaches: switching, camera-relative
 * movement, charge/release kicks, tackling and skill moves.
 *
 * It is deliberately a *mediocre* player: it reacts on a fixed cadence, aims
 * roughly, and has no lookahead. If the human path is competitive when driven
 * this crudely, a real player will be fine.
 */
import { Action } from '../src/control/input.js';
import { PlayerState } from '../src/sim/player.js';
import { HALF_LENGTH, HALF_WIDTH, PLAYER } from '../src/core/config.js';

/** Minimal InputManager-compatible surface. */
export class ScriptedInput {
  constructor() {
    this.axis = { x: 0, z: 0 };
    this.held = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.frameId = 0;
  }
  move(x, z) {
    const l = Math.hypot(x, z);
    if (l > 1) {
      x /= l;
      z /= l;
    }
    this.axis.x = x;
    this.axis.z = z;
  }
  press(a) {
    if (!this.held.has(a)) this.pressed.add(a);
    this.held.add(a);
  }
  hold(a) {
    this.held.add(a);
  }
  release(a) {
    if (this.held.has(a)) this.released.add(a);
    this.held.delete(a);
  }
  tap(a) {
    this.press(a);
    this._toRelease = this._toRelease || [];
    this._toRelease.push(a);
  }
  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.frameId++;
    if (this._toRelease) {
      for (const a of this._toRelease) this.release(a);
      this._toRelease = null;
    }
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

export class BotPlayer {
  /**
   * @param {object} opts
   * @param {Match} opts.match
   * @param {PlayerController} opts.controller
   * @param {ScriptedInput} opts.input
   * @param {Rng} opts.rng
   * @param {number} opts.reaction  seconds between decisions
   */
  constructor({ match, controller, input, rng, reaction = 0.18 }) {
    this.match = match;
    this.controller = controller;
    this.input = input;
    this.rng = rng;
    this.reaction = reaction;
    this.timer = 0;
    this.chargeFor = 0;
    this.chargeAction = null;
    // Bookkeeping the audit reads back.
    this.stats = { shots: 0, passes: 0, tackles: 0, switches: 0, skills: 0 };
  }

  get team() {
    return this.controller.teamId;
  }

  get attackDir() {
    return this.match.world.teams[this.team][0].attackDir;
  }

  /** Called once per simulation step, before `match.step`. */
  update(dt) {
    const input = this.input;
    const p = this.controller.controlledPlayer;
    const ball = this.match.world.ball;
    if (!p) return;

    // Release a charged kick when its hold time expires.
    if (this.chargeAction) {
      this.chargeFor -= dt;
      if (this.chargeFor <= 0) {
        input.release(this.chargeAction);
        this.chargeAction = null;
      }
    }

    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = this.reaction;

    if (p.state === PlayerState.STUMBLE || p.state === PlayerState.FROZEN) {
      input.move(0, 0);
      return;
    }

    const hasBall = ball.owner === p;
    const dir = this.attackDir;
    const goalX = HALF_LENGTH * dir;

    if (hasBall) {
      this.withBall(p, ball, goalX, dir);
    } else {
      this.withoutBall(p, ball);
    }
  }

  /** Begin a charged kick, clearing any charge still held from before. */
  startCharge(action, seconds) {
    if (this.chargeAction && this.chargeAction !== action) {
      this.input.release(this.chargeAction);
    }
    this.input.press(action);
    this.chargeAction = action;
    this.chargeFor = seconds;
  }

  withBall(p, ball, goalX, dir) {
    const input = this.input;
    const distToGoal = Math.hypot(goalX - p.pos.x, p.pos.z);
    const opps = this.match.world.teams[1 - this.team];

    let pressure = 0;
    for (const o of opps) {
      if (o.isKeeper) continue;
      const d = Math.hypot(o.pos.x - p.pos.x, o.pos.z - p.pos.z);
      if (d < 4.5) pressure += 1 - d / 4.5;
    }

    // Shoot when in range and the angle isn't hopeless.
    const angleOk = Math.abs(p.pos.z) < 18;
    if (distToGoal < 20 && angleOk && this.rng.chance(0.6)) {
      this.aim(goalX - p.pos.x, -p.pos.z * 0.4);
      this.startCharge(Action.SHOOT, this.rng.range(0.2, 0.6));
      this.stats.shots++;
      return;
    }

    // Only release under genuine pressure — a player who passes the instant
    // anyone comes near never carries the ball into the final third, which is
    // what made the first version of this bot take 0.75 shots per match.
    if (pressure > 1.15 && this.rng.chance(0.6)) {
      const mate = this.bestMate(p);
      if (mate) {
        this.aim(mate.pos.x - p.pos.x, mate.pos.z - p.pos.z);
        this.startCharge(Action.PASS, this.rng.range(0.05, 0.22));
        this.stats.passes++;
        return;
      }
    }

    if (pressure > 1.4 && this.rng.chance(0.3)) {
      input.tap(Action.SKILL);
      this.stats.skills++;
    }

    // Carry toward goal, drifting off the touchline.
    let tz = -p.pos.z * 0.35;
    if (Math.abs(p.pos.z) > HALF_WIDTH - 6) tz = -Math.sign(p.pos.z) * 3;
    this.aim(goalX - p.pos.x, tz);
    if (pressure < 0.6) input.hold(Action.SPRINT);
    else input.release(Action.SPRINT);
  }

  withoutBall(p, ball) {
    const input = this.input;
    const d = Math.hypot(ball.pos.x - p.pos.x, ball.pos.z - p.pos.z);
    const owner = ball.owner;

    // Occasionally switch, to exercise that path.
    if (this.rng.chance(0.04)) {
      input.tap(Action.SWITCH);
      this.stats.switches++;
    }

    if (owner && owner.team !== this.team && d < PLAYER.tackleRange * 1.3 && this.rng.chance(0.5)) {
      input.tap(Action.TACKLE);
      this.stats.tackles++;
    }

    // Chase the ball.
    this.aim(ball.pos.x - p.pos.x, ball.pos.z - p.pos.z);
    if (d > 3) input.hold(Action.SPRINT);
    else input.release(Action.SPRINT);
  }

  bestMate(p) {
    const dir = this.attackDir;
    let best = null;
    let bestScore = -Infinity;
    for (const m of this.match.world.teams[this.team]) {
      if (m === p || m.isKeeper) continue;
      const d = Math.hypot(m.pos.x - p.pos.x, m.pos.z - p.pos.z);
      if (d < 4 || d > 28) continue;
      const progress = (m.pos.x - p.pos.x) * dir;
      const score = progress - d * 0.2;
      if (score > bestScore) {
        bestScore = score;
        best = m;
      }
    }
    return best;
  }

  /**
   * Convert a world-space direction into the camera-space axis the controller
   * expects. The default basis is forward = (0,-1), right = (1,0), so
   * axis.x = -worldZ and axis.z = worldX.
   */
  aim(wx, wz) {
    const l = Math.hypot(wx, wz) || 1;
    this.input.move(-wz / l, wx / l);
  }
}
