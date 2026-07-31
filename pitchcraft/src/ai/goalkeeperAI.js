import { KEEPER, PITCH, BALL, PLAYER, KICK, HALF_LENGTH, HALF_WIDTH, HALF_GOAL } from '../core/config.js';
import { PlayerState } from '../sim/player.js';
import { clamp, lerp, dist2, smoothstep } from '../core/vec.js';
import { EV } from '../core/events.js';
import { buildKick, laneSafety } from '../sim/kicks.js';

/**
 * Goalkeeper behaviour as an explicit state machine:
 *   POSITION -> (shot detected) -> DIVE -> RECOVER -> POSITION
 *              -> (through ball / 1v1) -> RUSH
 *              -> (ball held) -> DISTRIBUTE
 *
 * Positioning uses a goal-line arc so the keeper narrows the angle naturally
 * instead of tracking the ball's z coordinate one-for-one.
 */
export class GoalkeeperAI {
  constructor({ world, teamId, bus, rng, difficulty }) {
    this.world = world;
    this.teamId = teamId;
    this.bus = bus;
    this.rng = rng;
    this.difficulty = difficulty;
    this.keeper = world.keeperOf(teamId);
    this.attackDir = this.keeper.attackDir;
    this.goalX = -HALF_LENGTH * this.attackDir;
    this.state = 'position';
    this.stateTime = 0;
    this.reactionTimer = 0;
    this.holdTimer = 0;
    this.recoverTimer = 0;
    this.lastShotId = null;
  }

  reset() {
    this.state = 'position';
    this.stateTime = 0;
    this.reactionTimer = 0;
    this.holdTimer = 0;
    this.recoverTimer = 0;
  }

  update(dt) {
    const gk = this.keeper;
    this.stateTime += dt;

    if (gk.state === PlayerState.FROZEN || gk.state === PlayerState.CELEBRATE) return;

    switch (this.state) {
      case 'hold':
        this.updateHold(dt);
        break;
      case 'dive':
        this.updateDive(dt);
        break;
      case 'recover':
        this.updateRecover(dt);
        break;
      default:
        this.updatePosition(dt);
        break;
    }
  }

  setState(s) {
    if (this.state === s) return;
    this.state = s;
    this.stateTime = 0;
  }

  /** Where the keeper wants to stand for the current ball position. */
  idealPosition() {
    const ball = this.world.ball;
    const dir = this.attackDir;
    const goalX = this.goalX;

    // How far off the line: further out when the ball is further away, capped.
    const distToBall = Math.hypot(ball.pos.x - goalX, ball.pos.z);
    const advance = clamp(
      KEEPER.lineDepth + smoothstep(HALF_LENGTH * 1.4, 8, distToBall) * KEEPER.maxAdvance * 0.55,
      KEEPER.lineDepth,
      KEEPER.maxAdvance
    );

    // Narrow the angle: sit on the bisector between ball and the two posts.
    const dz = ball.pos.z;
    const dx = Math.abs(ball.pos.x - goalX) || 1;
    const z = clamp(dz * (advance / dx) * (1 + KEEPER.angleFactor), -HALF_GOAL * 1.15, HALF_GOAL * 1.15);

    return { x: goalX - dir * -advance, z };
  }

  updatePosition(dt) {
    const gk = this.keeper;
    const ball = this.world.ball;
    const dir = this.attackDir;

    // Did the ball just get held?
    if (this.holdTimer > 0) {
      this.setState('hold');
      return;
    }

    // Shot detection.
    const shot = this.projectShot();
    if (shot) {
      this.reactionTimer += dt;
      const react = KEEPER.reactionTime + (this.difficulty?.reaction ?? 0.14);
      if (this.reactionTimer >= react * 0.5) {
        this.commitSave(shot);
        return;
      }
    } else {
      this.reactionTimer = 0;
    }

    // Rush out for a loose ball inside the box / clear through balls.
    const insideBox =
      Math.abs(ball.pos.x - this.goalX) < PITCH.penaltyAreaDepth &&
      Math.abs(ball.pos.z) < PITCH.penaltyAreaWidth / 2;
    const oppOwner = ball.owner && ball.owner.team !== this.teamId;
    const ownOwner = ball.owner && ball.owner.team === this.teamId;

    if (insideBox && !ownOwner) {
      const d = dist2(gk.pos, ball.pos);
      const nearestOpp = this.nearestOpponentToBall();
      const oppD = nearestOpp ? dist2(nearestOpp.pos, ball.pos) : 99;
      // Only come for it when we genuinely get there first.
      if (d < KEEPER.rushThreshold && (d < oppD - 0.6 || (!oppOwner && d < 2.6))) {
        this.driveTo(ball.pos.x, ball.pos.z, true);
        this.tryClaim();
        return;
      }
    }

    // Sweep behind the defence for balls played over the top.
    const ideal = this.idealPosition();
    let tx = ideal.x;
    let tz = ideal.z;

    if (!ownOwner && ball.pos.y < 1.2) {
      const throughBall =
        ball.inFlightFrom &&
        ball.inFlightFrom.team !== this.teamId &&
        (ball.vel.x * dir) < -6;
      if (throughBall) {
        // Predict where the ball will be and meet it if we can beat everyone there.
        const t = clamp(Math.abs(ball.pos.x - this.goalX) / Math.max(Math.abs(ball.vel.x), 1), 0, 1.4);
        const px = ball.pos.x + ball.vel.x * t * 0.7;
        const pz = ball.pos.z + ball.vel.z * t * 0.7;
        if (Math.abs(px - this.goalX) < PITCH.penaltyAreaDepth && Math.abs(pz) < PITCH.penaltyAreaWidth / 2) {
          tx = lerp(tx, px, 0.75);
          tz = lerp(tz, pz, 0.75);
        }
      }
    }

    this.driveTo(tx, tz, dist2(gk.pos, { x: tx, z: tz }) > 5);
    this.tryClaim();
  }

  /**
   * Predict whether the ball is heading into our goal within the next second.
   *
   * Returns the crossing point at the goal line (used to decide "is this on
   * target?") *and* the crossing point at the keeper's own x plane (used to
   * decide where to dive). Those are very different numbers when the keeper is
   * several metres off the line, and conflating them makes keepers dive at the
   * wrong spot and concede almost everything.
   */
  projectShot() {
    const ball = this.world.ball;
    const dir = this.attackDir;
    const goalX = this.goalX;
    const gk = this.keeper;

    const vx = ball.vel.x;
    // Must be travelling toward our goal with real pace.
    if (vx * dir > -4.5) return null;

    const crossingAt = (planeX) => {
      const t = (planeX - ball.pos.x) / vx;
      if (t < 0 || t > 1.6) return null;
      const drag = ball.airborne ? Math.exp(-BALL.airDrag * t) : Math.exp(-BALL.groundDecay * t);
      const z = ball.pos.z + ball.vel.z * t * drag;
      const y = ball.airborne
        ? Math.max(BALL.radius, ball.pos.y + ball.vel.y * t - 0.5 * BALL.gravity * t * t)
        : BALL.radius;
      return { z, y, t };
    };

    const atGoal = crossingAt(goalX);
    if (!atGoal) return null;

    // Give a little margin outside the frame so the keeper still reacts to near misses.
    if (Math.abs(atGoal.z) > HALF_GOAL + 1.5) return null;
    if (atGoal.y > PITCH.goalHeight + 1.0) return null;

    // The keeper intercepts at its own plane — but never behind the goal line.
    const planeX = dir > 0 ? Math.min(gk.pos.x, goalX) : Math.max(gk.pos.x, goalX);
    const atKeeper = crossingAt(planeX) || atGoal;

    return {
      z: atGoal.z,
      y: atGoal.y,
      t: atGoal.t,
      // Where the ball will actually pass the keeper.
      planeZ: atKeeper.z,
      planeY: atKeeper.y,
      planeT: atKeeper.t,
      speed: Math.hypot(ball.vel.x, ball.vel.y, ball.vel.z),
    };
  }

  commitSave(shot) {
    const gk = this.keeper;
    // Judge the dive against where the ball passes *this* keeper.
    const dz = shot.planeZ - gk.pos.z;
    const absDz = Math.abs(dz);
    const high = shot.planeY > 1.15;
    const timeToReach = Math.max(shot.planeT, 0.05);

    // Can we get anything to it? Reach plus however far we can travel in time.
    const reach = high ? KEEPER.highReach : KEEPER.reach;
    const coverable = reach + KEEPER.diveSpeed * Math.min(timeToReach, KEEPER.diveDuration) * 0.55;

    // Save probability: fast shots and ones we have to stretch for are harder.
    let p = KEEPER.baseSave;
    p -= shot.speed * KEEPER.speedPenalty;
    p -= clamp(absDz / Math.max(coverable, 0.5), 0, 1.4) * 0.42;
    if (high) p -= 0.1;
    p += (this.difficulty?.keeperSkill ?? 0) * 0.1;
    p = clamp(p, 0.05, 0.97);

    const willSave = this.rng.chance(p) && absDz < coverable;

    // Dive regardless — a beaten keeper still dives, which reads correctly.
    const diveDir = Math.sign(dz) || (this.rng.chance(0.5) ? 1 : -1);
    const lateral = clamp(absDz / timeToReach, 0, KEEPER.diveSpeed);
    const vz = diveDir * (willSave ? Math.max(lateral, absDz * 3.4) : lateral * 0.75);
    const vx = this.attackDir * 0.8; // small step forward into the shot

    gk.startDive(vx, vz, KEEPER.diveDuration, diveDir);
    gk.saveIntent = willSave ? { z: shot.planeZ, y: shot.planeY, high } : null;
    this.setState('dive');
    this.bus.emit(EV.SAVE, { keeper: gk, attempt: true, willSave, high, pos: { ...gk.pos } });
  }

  updateDive(dt) {
    const gk = this.keeper;
    const ball = this.world.ball;
    const intent = gk.saveIntent;

    if (intent && ball.owner !== gk) {
      const dir = this.attackDir;
      const d = Math.hypot(ball.pos.x - gk.pos.x, ball.pos.z - gk.pos.z);
      const heightOk = ball.pos.y < KEEPER.highReach;

      // The save was already decided when the keeper committed. Once the ball
      // actually reaches the keeper's plane we must resolve it, otherwise a
      // "saved" shot sails through the dive and the keeper looks broken.
      const reachedPlane = dir > 0 ? ball.pos.x <= gk.pos.x + 0.5 : ball.pos.x >= gk.pos.x - 0.5;

      if (heightOk && (d < KEEPER.reach || reachedPlane)) {
        // Let the dive stretch to the ball so the contact reads correctly,
        // bounded by how far a keeper could plausibly extend.
        const maxStretch = KEEPER.reach;
        const dz = clamp(ball.pos.z - gk.pos.z, -maxStretch, maxStretch);
        gk.pos.z += dz * 0.65;
        this.makeSave(intent.high);
        return;
      }
    }

    if (gk.state !== PlayerState.DIVE) {
      this.recoverTimer = KEEPER.diveRecover;
      this.setState('recover');
    }
  }

  makeSave(high) {
    const gk = this.keeper;
    const ball = this.world.ball;
    const dir = this.attackDir;

    const speed = ball.speed;
    // Catch cleanly, or parry to safety.
    const catchIt = !high && speed < 22 && this.rng.chance(KEEPER.catchChance);

    if (catchIt) {
      ball.owner = gk;
      gk.hasBall = true;
      ball.vel.x = 0;
      ball.vel.y = 0;
      ball.vel.z = 0;
      ball.pos.x = gk.pos.x;
      ball.pos.z = gk.pos.z;
      ball.pos.y = BALL.radius;
      ball.touch(gk, null);
      ball.frozen = true;
      this.holdTimer = KEEPER.distributeDelay;
      this.setState('hold');
      this.bus.emit(EV.CATCH, { keeper: gk, pos: { ...ball.pos } });
    } else {
      // Parry wide and away from the centre of goal.
      const sideZ = Math.sign(ball.pos.z || (this.rng.chance(0.5) ? 1 : -1));
      const outSpeed = clamp(speed * 0.42 + 5, 6, 15);
      ball.owner = null;
      ball.launch(
        gk,
        {
          x: dir * outSpeed * 0.55,
          y: high ? 3.2 : 1.4,
          z: sideZ * outSpeed * 0.85,
        },
        0,
        'parry'
      );
      gk.possessionLock = 0.25;
      this.recoverTimer = KEEPER.diveRecover;
      this.setState('recover');
    }
    this.bus.emit(EV.SAVE, { keeper: gk, attempt: false, caught: catchIt, pos: { ...gk.pos } });
  }

  updateRecover(dt) {
    const gk = this.keeper;
    this.recoverTimer -= dt;
    // Scramble back toward the line while recovering.
    const ideal = this.idealPosition();
    this.driveTo(ideal.x, ideal.z, false, 0.6);
    if (this.recoverTimer <= 0 && gk.state !== PlayerState.DIVE) {
      gk.saveIntent = null;
      this.setState('position');
    }
  }

  updateHold(dt) {
    const gk = this.keeper;
    const ball = this.world.ball;
    this.holdTimer -= dt;

    ball.frozen = true;
    ball.pos.x = gk.pos.x + Math.sin(gk.heading) * 0.45;
    ball.pos.z = gk.pos.z + Math.cos(gk.heading) * 0.45;
    ball.pos.y = 0.95;

    // Step forward out of the goal before releasing.
    const dir = this.attackDir;
    const target = { x: this.goalX + dir * (PITCH.goalAreaDepth + 1.5), z: clamp(gk.pos.z, -8, 8) };
    this.driveTo(target.x, target.z, false, 0.7);

    if (this.holdTimer <= 0) {
      this.distribute();
    }
  }

  /** Release the ball: a safe pass if one exists, otherwise a long clearance. */
  distribute() {
    const gk = this.keeper;
    const ball = this.world.ball;
    const mates = this.world.teams[this.teamId].filter((p) => p !== gk);
    const opps = this.world.teams[1 - this.teamId];
    const dir = this.attackDir;

    ball.frozen = false;
    ball.owner = null;
    gk.hasBall = false;

    // Find the safest forward option.
    let best = null;
    for (const m of mates) {
      const d = dist2(gk.pos, m.pos);
      if (d < 6 || d > 30) continue;
      const lane = laneSafety(gk.pos, m.pos, opps, 1.7);
      const progress = ((m.pos.x - gk.pos.x) * dir) / 30;
      const score = lane * 2 + progress;
      if (lane > 0.45 && (!best || score > best.score)) {
        best = { player: m, x: m.pos.x + m.vel.x * 0.3, z: m.pos.z + m.vel.z * 0.3, score, d };
      }
    }

    let type;
    let target;
    let power;
    if (best && best.d < 22) {
      type = 'pass';
      target = { x: best.x, z: best.z };
      power = clamp(best.d / 24, 0.35, 1);
    } else {
      type = 'clear';
      const lane = best ? best.z : this.rng.spread(HALF_WIDTH * 0.6);
      target = { x: this.goalX + dir * 40, z: clamp(lane, -HALF_WIDTH * 0.7, HALF_WIDTH * 0.7) };
      power = 1;
    }

    const aimX = target.x - ball.pos.x;
    const aimZ = target.z - ball.pos.z;
    const { vel, spin } = buildKick(gk, ball, type, power, aimX, aimZ, target, 0, this.rng);
    gk.heading = Math.atan2(vel.x, vel.z);
    gk.triggerKickAnim(type);
    ball.pos.y = BALL.radius;
    ball.launch(gk, vel, spin, type, target);
    gk.possessionLock = PLAYER.possessionLockout;

    this.bus.emit(EV.PASS, { player: gk, type, target, power, pos: { ...ball.pos }, distribution: true });
    this.bus.emit(EV.KICK, { player: gk, type, power, pos: { ...ball.pos } });
    this.holdTimer = 0;
    this.setState('position');
  }

  /** Pick the ball up when it's at our feet inside the area. */
  tryClaim() {
    const gk = this.keeper;
    const ball = this.world.ball;
    if (ball.owner !== gk) return;
    const insideBox =
      Math.abs(ball.pos.x - this.goalX) < PITCH.penaltyAreaDepth &&
      Math.abs(ball.pos.z) < PITCH.penaltyAreaWidth / 2;
    if (!insideBox) return;
    ball.frozen = true;
    this.holdTimer = KEEPER.distributeDelay * 0.8;
    this.setState('hold');
    this.bus.emit(EV.CATCH, { keeper: gk, pos: { ...ball.pos } });
  }

  nearestOpponentToBall() {
    const ball = this.world.ball;
    let best = null;
    let bd = Infinity;
    for (const o of this.world.teams[1 - this.teamId]) {
      const d = dist2(o.pos, ball.pos);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  }

  driveTo(x, z, sprint = false, scale = 1) {
    const gk = this.keeper;
    if (gk.state === PlayerState.DIVE || gk.state === PlayerState.STUMBLE) return;
    const dx = x - gk.pos.x;
    const dz = z - gk.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.28) {
      gk.stop();
      // Always face the ball.
      const ball = this.world.ball;
      gk.facing = Math.atan2(ball.pos.x - gk.pos.x, ball.pos.z - gk.pos.z);
      gk.heading = gk.facing;
      return;
    }
    gk.move(dx / d, dz / d, clamp(d / 2.2, 0.3, 1) * scale, sprint);
  }
}
