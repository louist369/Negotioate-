import { BALL, PITCH, HALF_LENGTH, HALF_WIDTH, HALF_GOAL } from '../core/config.js';
import { clamp } from '../core/vec.js';

/**
 * The ball is a fully independent rigid body. Players never parent it —
 * dribbling applies impulses through `Ball.touch`, which keeps deflections,
 * interceptions and loose-ball contests physically honest.
 */
export class Ball {
  constructor() {
    this.pos = { x: 0, y: BALL.radius, z: 0 };
    this.vel = { x: 0, y: 0, z: 0 };
    /** Spin about the world Y axis; drives Magnus curve while airborne. */
    this.spin = 0;
    /** Visual roll accumulators, filled by the sim and consumed by the renderer. */
    this.rollAxis = { x: 0, y: 0, z: 0 };
    this.rollAngle = 0;

    this.lastToucher = null;
    this.lastToucherTeam = null;
    /** Second-to-last toucher, needed to award throw-ins correctly after deflections. */
    this.prevToucher = null;
    this.owner = null;
    this.inFlightFrom = null;
    /** Set by kick sites so AI can reason about a live pass. */
    this.intent = null;
    this.intentTarget = null;
    this.frozen = false;
    this.restingTime = 0;
  }

  reset(x = 0, z = 0) {
    this.pos.x = x;
    this.pos.y = BALL.radius;
    this.pos.z = z;
    this.vel.x = 0;
    this.vel.y = 0;
    this.vel.z = 0;
    this.spin = 0;
    this.rollAngle = 0;
    this.lastToucher = null;
    this.lastToucherTeam = null;
    this.prevToucher = null;
    this.owner = null;
    this.inFlightFrom = null;
    this.intent = null;
    this.intentTarget = null;
    this.frozen = false;
    this.restingTime = 0;
  }

  get speed() {
    return Math.hypot(this.vel.x, this.vel.y, this.vel.z);
  }

  get groundSpeed() {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  get airborne() {
    return this.pos.y > BALL.radius + 0.02;
  }

  /**
   * Register a player contact. `impulse` is added to velocity; `spin` is absolute.
   * Recording the toucher chain is what lets the rules layer award restarts.
   */
  touch(player, impulse, spin = null) {
    if (player && this.lastToucher !== player) {
      this.prevToucher = this.lastToucher;
    }
    if (player) {
      this.lastToucher = player;
      this.lastToucherTeam = player.team;
    }
    if (impulse) {
      this.vel.x += impulse.x;
      this.vel.y += impulse.y || 0;
      this.vel.z += impulse.z;
    }
    if (spin !== null) this.spin = spin;
    this.clampSpeed();
    this.restingTime = 0;
  }

  /** Replace velocity outright — used by kicks, saves and restarts. */
  launch(player, vel, spin = 0, intent = null, target = null) {
    if (player && this.lastToucher !== player) {
      this.prevToucher = this.lastToucher;
    }
    if (player) {
      this.lastToucher = player;
      this.lastToucherTeam = player.team;
    }
    this.vel.x = vel.x;
    this.vel.y = vel.y || 0;
    this.vel.z = vel.z;
    this.spin = spin;
    this.intent = intent;
    this.intentTarget = target;
    this.inFlightFrom = player;
    this.owner = null;
    this.restingTime = 0;
    this.clampSpeed();
  }

  clampSpeed() {
    const s = Math.hypot(this.vel.x, this.vel.y, this.vel.z);
    if (s > BALL.maxSpeed) {
      const k = BALL.maxSpeed / s;
      this.vel.x *= k;
      this.vel.y *= k;
      this.vel.z *= k;
    }
  }

  step(dt) {
    if (this.frozen) return;

    // A ball resting exactly on the turf that has just been lifted must be
    // treated as airborne immediately, or the rolling branch eats its lift.
    const airborne = this.pos.y > BALL.radius + 1e-4 || this.vel.y > 1e-4;

    if (airborne) {
      this.vel.y -= BALL.gravity * dt;

      // Quadratic-ish air drag.
      const s = this.speed;
      if (s > 0.01) {
        const d = BALL.airDrag * s * dt;
        const k = Math.max(0, 1 - d / Math.max(s, 1e-4));
        this.vel.x *= k;
        this.vel.y *= k;
        this.vel.z *= k;
      }

      // Magnus: spin about Y curves the horizontal velocity vector sideways.
      if (Math.abs(this.spin) > 1e-3) {
        const gs = Math.hypot(this.vel.x, this.vel.z);
        const a = BALL.magnus * this.spin * gs * dt;
        // Perpendicular in the ground plane.
        const px = -this.vel.z;
        const pz = this.vel.x;
        const pl = Math.hypot(px, pz) || 1;
        this.vel.x += (px / pl) * a;
        this.vel.z += (pz / pl) * a;
      }
    } else {
      // Rolling: exponential decay plus a constant stopping term, so the ball
      // actually comes to rest instead of creeping forever.
      const gs = Math.hypot(this.vel.x, this.vel.z);
      if (gs > 1e-4) {
        const decay = Math.exp(-BALL.groundDecay * dt);
        let ns = gs * decay - BALL.groundStop * dt;
        if (ns < 0.06) ns = 0;
        const k = ns / gs;
        this.vel.x *= k;
        this.vel.z *= k;
      }
      this.vel.y = 0;
      this.pos.y = BALL.radius;
      this.spin *= Math.exp(-BALL.spinDecay * 2 * dt);
    }

    this.spin *= Math.exp(-BALL.spinDecay * dt);

    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.pos.z += this.vel.z * dt;

    // Ground collision + bounce.
    if (this.pos.y < BALL.radius) {
      const impactSpeed = -this.vel.y;
      this.pos.y = BALL.radius;
      if (impactSpeed > 0.55) {
        this.vel.y = impactSpeed * BALL.restitution;
        this.vel.x *= BALL.bounceFriction;
        this.vel.z *= BALL.bounceFriction;
        this.onBounce?.(impactSpeed);
      } else {
        this.vel.y = 0;
      }
    }

    // Roll visualisation: axis is perpendicular to travel, angle from distance.
    const gs = Math.hypot(this.vel.x, this.vel.z);
    if (gs > 0.02) {
      const inv = 1 / gs;
      this.rollAxis.x = -this.vel.z * inv;
      this.rollAxis.y = 0;
      this.rollAxis.z = this.vel.x * inv;
      this.rollAngle += (gs * dt) / BALL.radius;
    }

    if (this.speed < 0.12) this.restingTime += dt;
    else this.restingTime = 0;
  }

  /** True while the ball is between the posts, under the bar and past the line. */
  goalCheck(sideX) {
    // sideX is +1 for the goal at +x, -1 for the goal at -x.
    const line = HALF_LENGTH * sideX;
    const past = sideX > 0 ? this.pos.x - BALL.radius > line : this.pos.x + BALL.radius < line;
    if (!past) return false;
    if (Math.abs(this.pos.z) > HALF_GOAL - BALL.radius * 0.5) return false;
    if (this.pos.y > PITCH.goalHeight - BALL.radius * 0.4) return false;
    if (Math.abs(this.pos.x) > HALF_LENGTH + PITCH.goalDepth) return false;
    return true;
  }

  /** Out of play test, evaluated against the outer edge of the ball. */
  outOfPlay() {
    const r = BALL.radius;
    if (Math.abs(this.pos.z) > HALF_WIDTH + r) {
      return { type: 'touchline', side: Math.sign(this.pos.z) };
    }
    if (Math.abs(this.pos.x) > HALF_LENGTH + r) {
      return { type: 'byline', side: Math.sign(this.pos.x) };
    }
    return null;
  }

  /** Keep a stray ball from escaping the world entirely (safety net for restarts). */
  clampToWorld() {
    const lim = HALF_LENGTH + PITCH.margin;
    const limz = HALF_WIDTH + PITCH.margin;
    this.pos.x = clamp(this.pos.x, -lim, lim);
    this.pos.z = clamp(this.pos.z, -limz, limz);
    this.pos.y = clamp(this.pos.y, BALL.radius, 30);
  }
}
