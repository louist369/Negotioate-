import { Ball } from './ball.js';
import { Player, PlayerState, resetPlayerIds } from './player.js';
import {
  PITCH,
  BALL,
  PLAYER,
  TEAMS,
  FORMATIONS,
  AI,
  HALF_LENGTH,
  HALF_WIDTH,
  HALF_GOAL,
} from '../core/config.js';
import { EV } from '../core/events.js';
import { clamp, lerp, dist2, distSq2, v2 } from '../core/vec.js';

const tmp = v2();
const tmp2 = v2();

/**
 * Owns every physical entity and resolves all contact between them. The world
 * knows nothing about match rules — it only answers "what physically happened".
 */
export class World {
  constructor({ bus, rng, formation = '7v7' }) {
    this.bus = bus;
    this.rng = rng;
    this.formationKey = formation;
    this.ball = new Ball();
    this.ball.onBounce = (speed) => {
      if (speed > 2.2) this.bus.emit(EV.TOUCH, { kind: 'bounce', speed, pos: { ...this.ball.pos } });
    };

    this.teams = [[], []];
    this.players = [];
    this.time = 0;

    this.buildTeams();
  }

  buildTeams() {
    resetPlayerIds();
    const template = FORMATIONS[this.formationKey] || FORMATIONS['7v7'];
    this.players.length = 0;
    this.teams = [[], []];

    for (let t = 0; t < 2; t++) {
      const teamCfg = TEAMS[t];
      const numbers = [1, 4, 5, 7, 8, 11, 9, 2, 3, 6, 10];
      for (let i = 0; i < template.length; i++) {
        const slot = template[i];
        const p = new Player({
          team: t,
          role: slot.role,
          index: i,
          isKeeper: slot.role === 'GK',
          attackDir: teamCfg.attackDir,
          skinIndex: (i * 3 + t * 2) % teamCfg.colors.skinPalette.length,
          number: numbers[i] ?? i + 1,
        });
        p.formationSlot = { x: slot.x, z: slot.z };
        this.teams[t].push(p);
        this.players.push(p);
      }
    }
  }

  get formation() {
    return FORMATIONS[this.formationKey] || FORMATIONS['7v7'];
  }

  keeperOf(team) {
    return this.teams[team][0];
  }

  opponentsOf(team) {
    return this.teams[1 - team];
  }

  /** World-space position of a player's formation slot, given the team's line height. */
  slotPosition(player, lineHeight, compact = 1) {
    const slot = player.formationSlot;
    const dir = player.attackDir;
    const x = (slot.x * compact + lineHeight) * HALF_LENGTH * dir;
    const z = slot.z * HALF_WIDTH * 0.92 * lerp(1, 0.78, 1 - compact);
    return {
      x: clamp(x, -HALF_LENGTH + 1.4, HALF_LENGTH - 1.4),
      z: clamp(z, -HALF_WIDTH + 1.2, HALF_WIDTH - 1.2),
    };
  }

  nearestPlayerToBall(team = null, filter = null) {
    let best = null;
    let bestD = Infinity;
    for (const p of this.players) {
      if (team !== null && p.team !== team) continue;
      if (filter && !filter(p)) continue;
      const d = distSq2(p.pos, this.ball.pos);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  step(dt) {
    this.time += dt;

    for (const p of this.players) p.step(dt);
    this.ball.step(dt);

    this.resolvePlayerSeparation();
    this.resolveTackles(dt);
    this.resolveBallContacts(dt);
    this.resolveGoalFrame();
    this.constrainPlayers();
  }

  /** Soft body separation so players never stack on top of each other. */
  resolvePlayerSeparation() {
    const n = this.players.length;
    const minDist = PLAYER.radius * 2;
    for (let i = 0; i < n; i++) {
      const a = this.players[i];
      if (a.state === PlayerState.DIVE) continue;
      for (let j = i + 1; j < n; j++) {
        const b = this.players[j];
        if (b.state === PlayerState.DIVE) continue;
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > minDist * minDist || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const overlap = (minDist - d) * 0.5;
        const ux = dx / d;
        const uz = dz / d;
        // A player in a committed tackle pushes rather than gets pushed.
        const aw = a.state === PlayerState.TACKLE ? 0.15 : 1;
        const bw = b.state === PlayerState.TACKLE ? 0.15 : 1;
        const total = aw + bw || 1;
        a.pos.x -= ux * overlap * ((aw / total) * 2);
        a.pos.z -= uz * overlap * ((aw / total) * 2);
        b.pos.x += ux * overlap * ((bw / total) * 2);
        b.pos.z += uz * overlap * ((bw / total) * 2);
      }
    }
  }

  /** Resolve committed tackles against the current ball carrier. */
  resolveTackles(dt) {
    const owner = this.ball.owner;
    for (const p of this.players) {
      if (p.state !== PlayerState.TACKLE) continue;
      if (p.tackleResolved) continue;

      const dBall = dist2(p.pos, this.ball.pos);

      // Clean ball-win: reach the ball itself.
      if (dBall < PLAYER.tackleRange * 0.8) {
        p.tackleResolved = true;
        const victim = owner && owner !== p && owner.team !== p.team ? owner : null;

        // Contest odds tilt on closing speed and whether the carrier saw it coming.
        let winChance = AI.tackleWinBase;
        if (victim) {
          const facing = Math.cos(victim.heading - p.heading);
          winChance += facing > 0 ? 0.1 : -0.08;
          winChance -= (victim.attrs.control - 1) * 0.5;
          // A carrier at full tilt is harder to dispossess cleanly.
          winChance -= clamp(victim.speed / PLAYER.sprintSpeed, 0, 1) * 0.12;
          winChance = clamp(winChance, 0.2, 0.8);
        } else {
          winChance = 0.96; // loose ball, nobody to beat
        }

        if (this.rng.chance(winChance)) {
          if (victim) {
            victim.hasBall = false;
            victim.possessionLock = PLAYER.possessionLockout;
            if (this.rng.chance(0.45)) victim.stumble();
            this.bus.emit(EV.STUMBLE, { player: victim });
          }
          // Poke the ball forward off the tackler's boot.
          const hx = Math.sin(p.heading);
          const hz = Math.cos(p.heading);
          this.ball.owner = null;
          this.ball.launch(p, { x: hx * 4.6, y: 0.7, z: hz * 4.6 }, 0, 'poke');
          p.possessionLock = 0;
          this.bus.emit(EV.TACKLE_WON, { player: p, victim, pos: { ...this.ball.pos } });
        } else {
          // Failed tackle — the tackler is out of the play for a moment.
          p.setState(PlayerState.STUMBLE);
          p.tackleCooldown = PLAYER.tackleCooldown * 1.6;
          this.bus.emit(EV.STUMBLE, { player: p });
        }
        this.bus.emit(EV.TACKLE, { player: p, success: true, pos: { ...p.pos } });
      } else if (owner && owner.team !== p.team && dist2(p.pos, owner.pos) < PLAYER.radius * 2.4) {
        // Caught the man, not the ball.
        p.tackleResolved = true;
        p.setState(PlayerState.STUMBLE);
        p.tackleCooldown = PLAYER.tackleCooldown * 1.8;
        this.bus.emit(EV.TACKLE, { player: p, success: false, pos: { ...p.pos } });
      }
    }

    for (const p of this.players) {
      if (p.state !== PlayerState.TACKLE) p.tackleResolved = false;
    }
  }

  /**
   * The heart of ball feel: dribble control, first touches, interceptions and
   * body deflections. Everything is impulse-based — the ball is never parented.
   */
  resolveBallContacts(dt) {
    const ball = this.ball;
    if (ball.frozen) return;

    // --- 1. Maintain existing close control -------------------------------
    const owner = ball.owner;
    if (owner) {
      const keep =
        owner.state !== PlayerState.STUMBLE &&
        owner.state !== PlayerState.TACKLE &&
        owner.state !== PlayerState.DIVE &&
        !ball.airborne &&
        dist2(owner.pos, ball.pos) < PLAYER.controlRadius * 2.3;

      if (!keep) {
        owner.hasBall = false;
        ball.owner = null;
        this.bus.emit(EV.POSSESSION, { player: null, previous: owner });
      } else {
        this.applyDribble(owner, dt);
        owner.hasBall = true;
      }
    }

    // --- 2. Contest for a loose ball --------------------------------------
    if (!ball.owner) {
      let claimant = null;
      let bestScore = -Infinity;

      for (const p of this.players) {
        if (p.state === PlayerState.STUMBLE || p.state === PlayerState.FROZEN) continue;
        if (p.possessionLock > 0) continue;
        // A player who has just taken a touch must let the ball travel before
        // touching it again. Without this the same player re-touches every tick
        // and the ball jitters instead of running free.
        if (p.controlCooldown > 0) continue;
        if (p === ball.inFlightFrom && ball.restingTime < 0.05 && this.ballTravelledLess(p, 1.2)) continue;

        const d = dist2(p.pos, ball.pos);
        const heightOk = p.isKeeper
          ? ball.pos.y < 2.6
          : ball.pos.y < 1.55 || (ball.pos.y < 2.1 && d < 1.0);
        if (!heightOk) continue;

        const reach = p.state === PlayerState.DIVE ? 1.9 : PLAYER.reachRadius;
        if (d > reach) continue;

        // Closer + better control attribute + facing the ball wins the touch.
        const facing =
          Math.sin(p.heading) * (ball.pos.x - p.pos.x) + Math.cos(p.heading) * (ball.pos.z - p.pos.z);
        const score = (reach - d) * 2 + p.attrs.control * 0.6 + (facing > 0 ? 0.45 : 0) + (p.isKeeper ? 0.9 : 0);
        if (score > bestScore) {
          bestScore = score;
          claimant = p;
        }
      }

      if (claimant) this.applyTouch(claimant, dt);
    }

    // --- 3. Body deflections for everyone who didn't get a clean touch -----
    for (const p of this.players) {
      if (p === ball.owner) continue;
      if (ball.pos.y > PLAYER.height * 0.95) continue;
      const d = dist2(p.pos, ball.pos);
      const rSum = PLAYER.radius + BALL.radius;
      if (d >= rSum || d < 1e-5) continue;

      const ux = (ball.pos.x - p.pos.x) / d;
      const uz = (ball.pos.z - p.pos.z) / d;
      // Push the ball out of the body...
      ball.pos.x = p.pos.x + ux * rSum;
      ball.pos.z = p.pos.z + uz * rSum;
      // ...and reflect the approaching component, adding the player's own momentum.
      const vn = ball.vel.x * ux + ball.vel.z * uz;
      if (vn < 0) {
        const rest = 0.55;
        ball.vel.x -= (1 + rest) * vn * ux;
        ball.vel.z -= (1 + rest) * vn * uz;
        ball.vel.x += p.vel.x * 0.32;
        ball.vel.z += p.vel.z * 0.32;
        ball.touch(p, null);
        if (Math.abs(vn) > 5) {
          this.bus.emit(EV.INTERCEPT, { player: p, kind: 'deflect', pos: { ...ball.pos } });
        }
      }
    }
  }

  ballTravelledLess(player, dist) {
    return dist2(player.pos, this.ball.pos) < dist;
  }

  /**
   * A touch on a loose or fast-moving ball. Fast balls are only partially
   * controlled — that gap is what makes interceptions and scrappy play happen.
   */
  applyTouch(player, dt) {
    const ball = this.ball;
    const relX = ball.vel.x - player.vel.x;
    const relZ = ball.vel.z - player.vel.z;
    const relSpeed = Math.hypot(relX, relZ, ball.vel.y);

    // Control quality falls off with the pace of the incoming ball.
    const skill = player.attrs.control * (player.isKeeper ? 1.35 : 1);
    const quality = clamp(1 - relSpeed / (17 * skill), 0.06, 1);

    const wasOwned = ball.owner;
    const interception =
      ball.inFlightFrom && ball.inFlightFrom.team !== player.team && relSpeed > 4;

    if (quality > 0.55 && !ball.airborne) {
      // Clean control: kill most of the pace and set the ball in front.
      ball.vel.x *= 0.12;
      ball.vel.z *= 0.12;
      ball.vel.y *= 0.2;
      ball.owner = player;
      player.hasBall = true;
      player.lastReceiveTime = this.time;
      player.controlCooldown = 0.12;
      ball.inFlightFrom = null;
      ball.intent = null;
      ball.touch(player, null);
      this.bus.emit(EV.POSSESSION, { player, previous: wasOwned, quality });
      if (interception) this.bus.emit(EV.INTERCEPT, { player, kind: 'clean', pos: { ...ball.pos } });
    } else {
      // Heavy first touch: the ball squirts away, weighted toward the player's run.
      const damp = lerp(0.86, 0.3, quality);
      ball.vel.x *= 1 - damp;
      ball.vel.z *= 1 - damp;
      ball.vel.y *= 0.35;
      const hx = Math.sin(player.heading);
      const hz = Math.cos(player.heading);
      const push = lerp(1.1, 3.0, quality);
      ball.vel.x += hx * push + this.rng.spread(0.9 * (1 - quality));
      ball.vel.z += hz * push + this.rng.spread(0.9 * (1 - quality));
      ball.touch(player, null);
      ball.inFlightFrom = null;
      // Heavier touches take longer to recover from, so a bad touch is a real
      // cost and opponents get a genuine window to pounce.
      player.controlCooldown = lerp(0.34, 0.16, quality);
      player.anim.kickPhase = Math.max(player.anim.kickPhase, 0.5);
      this.bus.emit(EV.TOUCH, { kind: 'firstTouch', player, quality, pos: { ...ball.pos } });
      if (interception) this.bus.emit(EV.INTERCEPT, { player, kind: 'heavy', pos: { ...ball.pos } });
    }
  }

  /**
   * Dribbling. Rather than gluing the ball to the foot, we push it toward a
   * moving control point. Faster running means bigger touches and more risk.
   */
  applyDribble(player, dt) {
    const ball = this.ball;
    const speed = player.speed;
    const speedRatio = clamp(speed / PLAYER.sprintSpeed, 0, 1);

    // Touch distance grows with pace — sprinting knocks the ball further ahead.
    const touchDist = lerp(0.55, 1.75, speedRatio);
    const cp = player.controlPoint(tmp, touchDist);

    const dx = cp.x - ball.pos.x;
    const dz = cp.z - ball.pos.z;
    const d = Math.hypot(dx, dz);

    if (d < 0.04) return;

    const ux = dx / d;
    const uz = dz / d;

    // Target ball velocity: match the player, plus a correction toward the point.
    const correction = clamp(d * lerp(5.5, 9.0, speedRatio), 0, 13);
    const targetVx = player.vel.x + ux * correction;
    const targetVz = player.vel.z + uz * correction;

    // Springy approach so the ball still reads as a physical object.
    const k = clamp(dt * lerp(13, 20, speedRatio), 0, 1);
    ball.vel.x = lerp(ball.vel.x, targetVx, k);
    ball.vel.z = lerp(ball.vel.z, targetVz, k);

    if (ball.pos.y > BALL.radius + 0.01) {
      ball.vel.y *= 0.7;
    }

    // Periodic "kick" so the dribble reads as discrete touches in the animation.
    player.dribbleTouchTimer = (player.dribbleTouchTimer ?? 0) - dt;
    if (player.dribbleTouchTimer <= 0 && speed > 1.5) {
      player.dribbleTouchTimer = lerp(0.42, 0.24, speedRatio);
      player.anim.kickPhase = Math.max(player.anim.kickPhase, 0.32);
      player.anim.kickType = 'dribble';
      this.bus.emit(EV.TOUCH, { kind: 'dribble', player, pos: { ...ball.pos }, speed });
    }

    ball.lastToucher = player;
    ball.lastToucherTeam = player.team;
  }

  /** Ball vs posts, crossbar and net. */
  resolveGoalFrame() {
    const ball = this.ball;
    for (const side of [-1, 1]) {
      const goalX = HALF_LENGTH * side;

      // Posts (vertical cylinders at the two ends of the goal line).
      for (const pz of [-HALF_GOAL, HALF_GOAL]) {
        if (ball.pos.y > PITCH.goalHeight + BALL.radius) continue;
        const dx = ball.pos.x - goalX;
        const dz = ball.pos.z - pz;
        const d = Math.hypot(dx, dz);
        const rSum = PITCH.postRadius + BALL.radius;
        if (d >= rSum || d < 1e-6) continue;
        const ux = dx / d;
        const uz = dz / d;
        ball.pos.x = goalX + ux * rSum;
        ball.pos.z = pz + uz * rSum;
        const vn = ball.vel.x * ux + ball.vel.z * uz;
        if (vn < 0) {
          ball.vel.x -= (1 + BALL.postRestitution) * vn * ux;
          ball.vel.z -= (1 + BALL.postRestitution) * vn * uz;
          this.bus.emit(EV.POST, { kind: 'post', pos: { ...ball.pos }, speed: Math.abs(vn) });
        }
      }

      // Crossbar: horizontal cylinder along z at y = goalHeight.
      if (Math.abs(ball.pos.z) < HALF_GOAL + PITCH.postRadius) {
        const dx = ball.pos.x - goalX;
        const dy = ball.pos.y - PITCH.goalHeight;
        const d = Math.hypot(dx, dy);
        const rSum = PITCH.postRadius + BALL.radius;
        if (d < rSum && d > 1e-6) {
          const ux = dx / d;
          const uy = dy / d;
          ball.pos.x = goalX + ux * rSum;
          ball.pos.y = PITCH.goalHeight + uy * rSum;
          const vn = ball.vel.x * ux + ball.vel.y * uy;
          if (vn < 0) {
            ball.vel.x -= (1 + BALL.postRestitution) * vn * ux;
            ball.vel.y -= (1 + BALL.postRestitution) * vn * uy;
            this.bus.emit(EV.POST, { kind: 'bar', pos: { ...ball.pos }, speed: Math.abs(vn) });
          }
        }
      }

      // Net: absorbs the ball once it is inside the goal.
      const insideMouth =
        Math.abs(ball.pos.z) < HALF_GOAL &&
        ball.pos.y < PITCH.goalHeight &&
        (side > 0 ? ball.pos.x > goalX : ball.pos.x < goalX);
      if (insideMouth) {
        const backX = goalX + side * PITCH.goalDepth;
        const past = side > 0 ? ball.pos.x > backX - BALL.radius : ball.pos.x < backX + BALL.radius;
        if (past) {
          ball.pos.x = backX - side * BALL.radius;
          ball.vel.x *= -0.22;
          ball.vel.z *= 0.5;
          ball.vel.y *= 0.3;
        }
        // Side netting.
        if (Math.abs(ball.pos.z) > HALF_GOAL - BALL.radius) {
          ball.pos.z = Math.sign(ball.pos.z) * (HALF_GOAL - BALL.radius);
          ball.vel.z *= -0.25;
        }
      }
    }
  }

  /** Keep players inside a generous play area around the pitch. */
  constrainPlayers() {
    const lx = HALF_LENGTH + PITCH.margin * 0.45;
    const lz = HALF_WIDTH + PITCH.margin * 0.45;
    for (const p of this.players) {
      if (p.pos.x < -lx) {
        p.pos.x = -lx;
        p.vel.x = Math.max(0, p.vel.x);
      } else if (p.pos.x > lx) {
        p.pos.x = lx;
        p.vel.x = Math.min(0, p.vel.x);
      }
      if (p.pos.z < -lz) {
        p.pos.z = -lz;
        p.vel.z = Math.max(0, p.vel.z);
      } else if (p.pos.z > lz) {
        p.pos.z = lz;
        p.vel.z = Math.min(0, p.vel.z);
      }
    }
  }
}
