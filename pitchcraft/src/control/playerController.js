import { Action } from './input.js';
import { PlayerState } from '../sim/player.js';
import { PLAYER, KICK, HALF_LENGTH, HALF_GOAL } from '../core/config.js';
import { clamp, dist2, distSq2 } from '../core/vec.js';
import { selectPassTarget, buildKick, pressureOn } from '../sim/kicks.js';
import { EV } from '../core/events.js';
import { Phase } from '../match/match.js';

/**
 * Kick keys that build power while held. Tuple is [action, kick type, seconds
 * to reach full charge].
 */
const CHARGEABLE = [
  [Action.SHOOT, 'shot', KICK.maxChargeTime],
  [Action.LOFT, 'loft', KICK.maxChargeTime],
  [Action.PASS, 'pass', KICK.maxChargeTime * 0.75],
];

/** Charge (0..1) to kick power, per kick type. */
const KICK_POWER = {
  shot: (c) => clamp(c * 0.85 + 0.25, 0.28, 1),
  loft: (c) => clamp(c * 0.8 + 0.3, 0.3, 1),
  pass: (c) => clamp(c * 0.7 + 0.3, 0.25, 1),
};

/**
 * Translates player input into simulation actions for one team.
 *
 * Design notes:
 *  - Movement is expressed in camera space and rotated into world space, so the
 *    controls stay intuitive whichever camera is active.
 *  - Kicks are assisted: the aim direction blends the raw stick input with the
 *    best candidate target, weighted by `KICK.assistBlend*`. Pointing somewhere
 *    deliberate always beats the assist.
 *  - Switching is both manual (Q / LB) and automatic on possession changes,
 *    because losing track of who you control is the fastest way to feel bad.
 */
export class PlayerController {
  constructor({ input, teamId, world, bus }) {
    this.input = input;
    this.teamId = teamId;
    this.world = world;
    this.bus = bus;

    this.controlledPlayer = null;
    this.manualSwitchTime = -99;
    this.charges = { shot: 0, loft: 0, pass: 0 };
    this.skillCooldown = 0;
    this.lastAxis = { x: 0, z: 0 };
    this.camBasis = { fwdX: 0, fwdZ: -1, rightX: 1, rightZ: 0 };
    this.time = 0;
    this.assistTarget = null;

    this.selectNearestToBall();
  }

  get team() {
    return this.world.teams[this.teamId];
  }

  clearCharges() {
    this.charges.shot = 0;
    this.charges.loft = 0;
    this.charges.pass = 0;
  }

  /** Largest active charge, for the HUD power meter. */
  get charge() {
    return Math.max(this.charges.shot, this.charges.loft, this.charges.pass);
  }

  /** Which kick the power meter is currently showing. */
  get chargeAction() {
    const { shot, loft, pass } = this.charges;
    const best = Math.max(shot, loft, pass);
    if (best <= 0) return null;
    return best === shot ? 'shot' : best === loft ? 'loft' : 'pass';
  }

  setCameraBasis(fwdX, fwdZ) {
    const l = Math.hypot(fwdX, fwdZ) || 1;
    this.camBasis.fwdX = fwdX / l;
    this.camBasis.fwdZ = fwdZ / l;
    // Right = forward rotated -90° about Y.
    this.camBasis.rightX = -this.camBasis.fwdZ;
    this.camBasis.rightZ = this.camBasis.fwdX;
  }

  /** Convert camera-space input into a world-space direction. */
  worldDir(axis) {
    const b = this.camBasis;
    return {
      x: b.fwdX * axis.x + b.rightX * axis.z,
      z: b.fwdZ * axis.x + b.rightZ * axis.z,
    };
  }

  selectNearestToBall(filter = null) {
    const ball = this.world.ball;
    let best = null;
    let bestD = Infinity;
    for (const p of this.team) {
      if (p.isKeeper) continue;
      if (filter && !filter(p)) continue;
      const d = distSq2(p.pos, ball.pos);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (best) this.setControlled(best);
    return best;
  }

  setControlled(p) {
    if (this.controlledPlayer === p) return;
    const prev = this.controlledPlayer;
    if (prev) prev.stop();
    this.controlledPlayer = p;
    this.bus.emit(EV.SWITCH, { player: p, previous: prev });
  }

  /**
   * Manual switch: prefer the teammate in the direction being pressed, otherwise
   * cycle to the next-nearest to the ball.
   */
  manualSwitch(axis) {
    const ball = this.world.ball;
    const cur = this.controlledPlayer;
    const dir = this.worldDir(axis);
    const hasDir = Math.hypot(dir.x, dir.z) > 0.3;

    const candidates = this.team.filter((p) => p !== cur && !p.isKeeper);
    if (!candidates.length) return;

    let best = null;
    let bestScore = -Infinity;
    const origin = cur ? cur.pos : ball.pos;

    for (const p of candidates) {
      const dx = p.pos.x - origin.x;
      const dz = p.pos.z - origin.z;
      const d = Math.hypot(dx, dz) || 1;
      const ballDist = dist2(p.pos, ball.pos);
      let score = -ballDist * 0.35;
      if (hasDir) {
        const align = (dx * dir.x + dz * dir.z) / d;
        if (align < 0.2) continue;
        score += align * 9 - d * 0.14;
      }
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }

    if (!best) {
      // Fall back to nearest-to-ball that isn't the current player.
      best = candidates.sort((a, b) => distSq2(a.pos, ball.pos) - distSq2(b.pos, ball.pos))[0];
    }
    if (best) {
      this.setControlled(best);
      this.manualSwitchTime = this.time;
    }
  }

  /**
   * Automatic switching. Keeps the human on the most relevant player without
   * fighting a deliberate manual choice (2s grace period).
   */
  autoSwitch(match) {
    const ball = this.world.ball;
    const cur = this.controlledPlayer;
    const sinceManual = this.time - this.manualSwitchTime;

    // Always hand control to whoever on our team actually has the ball.
    if (ball.owner && ball.owner.team === this.teamId && !ball.owner.isKeeper) {
      if (cur !== ball.owner) this.setControlled(ball.owner);
      return;
    }

    if (cur && cur.state === PlayerState.STUMBLE) {
      this.selectNearestToBall((p) => p !== cur && p.state !== PlayerState.STUMBLE);
      return;
    }

    if (sinceManual < 1.6) return;

    // Ball in flight toward one of ours → pre-switch to the likely receiver.
    if (ball.inFlightFrom && ball.inFlightFrom.team === this.teamId && ball.speed > 3) {
      const receiver = this.predictReceiver();
      if (receiver && receiver !== cur && !receiver.isKeeper) {
        this.setControlled(receiver);
        return;
      }
    }

    // Otherwise sit on the closest player to the ball.
    if (!ball.owner || ball.owner.team !== this.teamId) {
      const nearest = this.nearestToBall();
      if (nearest && nearest !== cur) {
        // Only switch if meaningfully closer, so control doesn't ping-pong.
        const curD = cur ? dist2(cur.pos, ball.pos) : Infinity;
        const newD = dist2(nearest.pos, ball.pos);
        if (newD < curD - 2.2) this.setControlled(nearest);
      }
    }
  }

  nearestToBall() {
    const ball = this.world.ball;
    let best = null;
    let bestD = Infinity;
    for (const p of this.team) {
      if (p.isKeeper) continue;
      if (p.state === PlayerState.STUMBLE) continue;
      const d = distSq2(p.pos, ball.pos);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  predictReceiver() {
    const ball = this.world.ball;
    if (ball.intentTarget) {
      let best = null;
      let bestD = Infinity;
      for (const p of this.team) {
        const d = distSq2(p.pos, ball.intentTarget);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      if (bestD < 64) return best;
    }
    // Fall back to whoever the ball's path best matches.
    let best = null;
    let bestD = Infinity;
    for (const p of this.team) {
      const t = clamp(
        ((p.pos.x - ball.pos.x) * ball.vel.x + (p.pos.z - ball.pos.z) * ball.vel.z) /
          Math.max(ball.vel.x ** 2 + ball.vel.z ** 2, 1e-3),
        0,
        1.6
      );
      const px = ball.pos.x + ball.vel.x * t;
      const pz = ball.pos.z + ball.vel.z * t;
      const d = distSq2(p.pos, { x: px, z: pz });
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return bestD < 36 ? best : null;
  }

  // ------------------------------------------------------------------ tick --

  update(dt, match) {
    this.time += dt;
    this.skillCooldown = Math.max(0, this.skillCooldown - dt);

    const input = this.input;
    const axis = input.axis;
    this.lastAxis.x = axis.x;
    this.lastAxis.z = axis.z;

    // A deliberate switch must be resolved *before* the automatic one, or the
    // auto-switch can move control on the same frame and the player's press
    // appears to do nothing.
    if (input.wasPressed(Action.SWITCH)) this.manualSwitch(axis);
    else this.autoSwitch(match);

    const p = this.controlledPlayer;
    if (!p) return;

    // Restart handling: the human can take their own restart.
    if (match.phase === Phase.RESTART || match.phase === Phase.KICKOFF) {
      this.handleRestartInput(match, axis);
      // Only the taker is scripted; everyone else still moves normally below.
      if (match.restart && match.restart.taker === p) return;
    }

    if (p.state === PlayerState.STUMBLE || p.state === PlayerState.FROZEN || p.state === PlayerState.DIVE) {
      return;
    }

    const dir = this.worldDir(axis);
    const mag = Math.hypot(dir.x, dir.z);
    const sprint = input.isDown(Action.SPRINT);

    if (mag > 0.08) {
      p.move(dir.x / mag, dir.z / mag, clamp(mag, 0, 1), sprint);
    } else {
      p.stop();
    }

    this.updateAssistTarget(dir, mag);
    this.handleActions(dt, match, dir, mag);
  }

  handleRestartInput(match, axis) {
    const r = match.restart;
    if (!r || r.team !== this.teamId) return;
    const taker = r.taker;
    if (!taker) return;

    // Let the human aim the restart with the stick and fire it with a kick key.
    const dir = this.worldDir(axis);
    const mag = Math.hypot(dir.x, dir.z);
    const aimDir = mag > 0.2 ? dir : { x: taker.attackDir, z: 0 };

    let kind = null;
    if (this.input.wasPressed(Action.PASS)) kind = 'pass';
    else if (this.input.wasPressed(Action.LOFT)) kind = 'loft';
    else if (this.input.wasPressed(Action.THROUGH)) kind = 'through';
    else if (this.input.wasPressed(Action.SHOOT)) kind = 'shot';

    if (!kind) return;

    // Prefer an assisted teammate in the pressed direction.
    const mates = this.team.filter((m) => m !== taker);
    const target = selectPassTarget(taker, mates, this.world.teams[1 - this.teamId], aimDir.x, aimDir.z, {
      maxRange: kind === 'loft' ? 40 : 26,
      cone: 1.5,
      allowKeeper: true,
    });

    const aim = target
      ? { x: target.x, z: target.z }
      : { x: r.spot.x + aimDir.x * 16, z: r.spot.z + aimDir.z * 16 };

    match.requestRestartTake(kind, aim, kind === 'loft' ? 0.8 : 0.62);
  }

  /** Cache the current assist candidate so the HUD can draw it. */
  updateAssistTarget(dir, mag) {
    const p = this.controlledPlayer;
    if (!p || !p.hasBall) {
      this.assistTarget = null;
      return;
    }
    const mates = this.team.filter((m) => m !== p);
    const target = selectPassTarget(p, mates, this.world.teams[1 - this.teamId], dir.x, dir.z, {
      maxRange: KICK.passMaxRange,
      cone: mag > 0.2 ? KICK.passCone : Math.PI,
      allowKeeper: true,
    });
    this.assistTarget = target;
  }

  handleActions(dt, match, dir, mag) {
    const input = this.input;
    const p = this.controlledPlayer;
    const ball = this.world.ball;
    const hasBall = ball.owner === p;

    // --- charge -----------------------------------------------------------
    //
    // Each kick key carries its OWN charge. A single shared `chargeAction` was
    // fragile: on the frame the shoot key is released it is no longer "down", so
    // if any other kick key happened to be held the charge was reassigned to
    // that action and the shot was silently dropped. Pressing shoot and getting
    // nothing is the worst possible failure in a football game.
    for (const [action, key, rate] of CHARGEABLE) {
      if (hasBall && input.isDown(action)) {
        this.charges[key] = clamp(this.charges[key] + dt / rate, 0, 1);
      }
    }

    if (!hasBall) this.clearCharges();

    // --- release ----------------------------------------------------------
    if (hasBall && p.kickCooldown <= 0) {
      let fired = false;
      for (const [action, key] of CHARGEABLE) {
        if (!input.wasReleased(action)) continue;
        // A tap still counts: any hold at all leaves a non-zero charge, and a
        // release with no accumulated charge falls back to a light touch.
        const power = KICK_POWER[key](this.charges[key]);
        this.fire(match, key, power, dir, mag);
        fired = true;
        break;
      }
      if (!fired && input.wasPressed(Action.THROUGH)) {
        this.fire(match, 'through', 0.7, dir, mag);
      }
    }

    // --- tackle / press ---------------------------------------------------
    if (input.wasPressed(Action.TACKLE) && !hasBall) {
      const tx = ball.pos.x - p.pos.x;
      const tz = ball.pos.z - p.pos.z;
      const d = Math.hypot(tx, tz);
      if (d < PLAYER.tackleRange * 1.6) {
        if (p.startTackle(tx, tz)) {
          this.bus.emit(EV.TACKLE, { player: p, attempt: true, pos: { ...p.pos } });
        }
      } else if (mag > 0.1) {
        // Out of range: use it as a committed sprint toward the ball.
        p.move(tx / (d || 1), tz / (d || 1), 1, true);
      }
    }

    // --- skill move -------------------------------------------------------
    if (input.wasPressed(Action.SKILL) && hasBall && this.skillCooldown <= 0) {
      this.skillMove(dir, mag);
    }
  }

  /**
   * A quick lateral knock past a defender. Pushes the ball sideways and gives the
   * player a short burst — cheap to execute, readable, and beatable.
   */
  skillMove(dir, mag) {
    const p = this.controlledPlayer;
    const ball = this.world.ball;
    this.skillCooldown = 0.9;

    // Side to knock toward: the input direction relative to current heading.
    const hx = Math.sin(p.heading);
    const hz = Math.cos(p.heading);
    let side;
    if (mag > 0.25) {
      const cross = hx * dir.z - hz * dir.x;
      side = Math.sign(cross) || 1;
    } else {
      side = Math.sign(-p.pos.z) || 1;
    }

    const px = -hz * side;
    const pz = hx * side;

    ball.owner = null;
    p.hasBall = false;
    p.possessionLock = 0.16;
    ball.launch(p, { x: (px * 5.4 + hx * 4.2), y: 0, z: (pz * 5.4 + hz * 4.2) }, side * 3, 'skill');

    // The player cuts the same way with a burst of pace.
    p.heading = Math.atan2(px * 0.75 + hx * 0.65, pz * 0.75 + hz * 0.65);
    p.vel.x = Math.sin(p.heading) * Math.max(p.speed, 5.6);
    p.vel.z = Math.cos(p.heading) * Math.max(p.speed, 5.6);
    p.triggerKickAnim('skill');

    this.bus.emit(EV.TOUCH, { kind: 'skill', player: p, pos: { ...ball.pos } });
  }

  fire(match, type, power, dir, mag) {
    const p = this.controlledPlayer;
    const ball = this.world.ball;
    const opponents = this.world.teams[1 - this.teamId];
    const mates = this.team.filter((m) => m !== p);
    const pressure = pressureOn(p, opponents, 5.0);

    let target = null;
    let aimX = dir.x;
    let aimZ = dir.z;

    if (mag < 0.1) {
      aimX = Math.sin(p.heading);
      aimZ = Math.cos(p.heading);
    }

    if (type === 'shot') {
      const keeper = this.world.keeperOf(1 - this.teamId);
      const goalX = HALF_LENGTH * p.attackDir;
      // Assist snaps the shot toward the goal frame, biased by the aim input.
      const aimZTarget = clamp(p.pos.z + aimZ * 8, -HALF_GOAL * 0.95, HALF_GOAL * 0.95);
      target = { x: goalX, z: aimZTarget };
    } else if (type === 'through') {
      target = selectPassTarget(p, mates, opponents, aimX, aimZ, {
        maxRange: 34,
        cone: 1.35,
        lead: 0.65,
        requireForward: false,
        allowKeeper: false,
      });
      if (target) {
        target = { x: target.x + p.attackDir * KICK.throughLead, z: target.z, player: target.player };
      }
    } else {
      target = selectPassTarget(p, mates, opponents, aimX, aimZ, {
        maxRange: type === 'loft' ? 40 : KICK.passMaxRange,
        cone: mag > 0.2 ? KICK.passCone : 0.85,
        lead: 0.3,
        allowKeeper: true,
      });
    }

    const { vel, spin } = buildKick(p, ball, type, power, aimX, aimZ, target, pressure, match.rng);

    ball.owner = null;
    p.hasBall = false;
    p.kickCooldown = KICK.kickCooldown;
    p.possessionLock = PLAYER.possessionLockout;
    p.heading = Math.atan2(vel.x, vel.z);
    p.triggerKickAnim(type);
    ball.launch(p, vel, spin, type, target ? { x: target.x, z: target.z } : null);

    this.clearCharges();

    if (type === 'shot') {
      this.bus.emit(EV.SHOT, { player: p, target, power, pos: { ...ball.pos } });
    } else {
      this.bus.emit(EV.PASS, { player: p, type, target, power, pos: { ...ball.pos } });
    }
    this.bus.emit(EV.KICK, { player: p, type, power, pos: { ...ball.pos } });
  }
}
