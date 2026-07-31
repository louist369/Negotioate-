import { KICK, BALL, HALF_LENGTH, HALF_GOAL, PITCH } from '../core/config.js';
import { clamp, lerp, dist2, v2 } from '../core/vec.js';

const tmpA = v2();
const tmpB = v2();

/**
 * Distance a ground ball travels before decaying from `v0` to `arrival`.
 *
 * The integrator applies v' = -k·v - c, whose closed form is
 *   v(t) = (v0 + a)·e^{-kt} - a,     a = c/k
 * and integrating gives the expression below. Having this in closed form lets us
 * *invert* it, which is what makes passes land on their target.
 */
export function rollDistance(v0, arrival = 0) {
  const k = BALL.groundDecay;
  const a = BALL.groundStop / k;
  if (v0 <= arrival) return 0;
  return (v0 - arrival) / k - (a / k) * Math.log((v0 + a) / (arrival + a));
}

/**
 * Launch speed needed for a ground pass to cover `range` and still be travelling
 * at `arrival` when it gets there. Newton's method on `rollDistance`, which
 * converges in three iterations across the whole useful range.
 */
export function groundPassSpeed(range, arrival = 4.5) {
  const k = BALL.groundDecay;
  const a = BALL.groundStop / k;
  // Seed with the frictionless answer, then correct.
  let v0 = arrival + range * k + BALL.groundStop * (range / Math.max(arrival, 4)) + 1;
  for (let i = 0; i < 6; i++) {
    const d = rollDistance(v0, arrival);
    const deriv = 1 / k - a / k / (v0 + a);
    if (Math.abs(deriv) < 1e-6) break;
    const next = v0 - (d - range) / deriv;
    if (!Number.isFinite(next)) break;
    v0 = Math.max(arrival + 0.2, next);
    if (Math.abs(d - range) < 0.01) break;
  }
  return clamp(v0, KICK.passMinSpeed * 0.45, KICK.passMaxSpeed);
}

/**
 * Lofted-pass range table, calibrated against the actual ball integrator.
 *
 * An analytic solution would have to duplicate the integrator's drag and bounce
 * model and then drift out of sync the moment either is retuned. Instead we
 * simulate a spread of launch speeds once at module load and invert the
 * resulting range curve by interpolation — always exact, and ~12k steps of
 * one-off cost.
 */
const LOFT_TABLE = { angle: null, speeds: [], ranges: [] };

function buildLoftTable(angle) {
  LOFT_TABLE.angle = angle;
  LOFT_TABLE.speeds.length = 0;
  LOFT_TABLE.ranges.length = 0;

  const dt = 1 / 120;
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);

  for (let speed = 5; speed <= 34.0001; speed += 0.5) {
    // Mirror the airborne branch of Ball.step (no spin — aim is unspun).
    let x = 0;
    let y = BALL.radius;
    let vx = ca * speed;
    let vy = sa * speed;

    for (let i = 0; i < 1500; i++) {
      vy -= BALL.gravity * dt;
      const s = Math.hypot(vx, vy);
      if (s > 0.01) {
        const k = Math.max(0, 1 - (BALL.airDrag * s * dt) / Math.max(s, 1e-4));
        vx *= k;
        vy *= k;
      }
      x += vx * dt;
      y += vy * dt;
      if (y <= BALL.radius) break; // first touch of grass is the landing point
    }

    LOFT_TABLE.speeds.push(speed);
    LOFT_TABLE.ranges.push(x);
  }
}

/** Launch speed so a lofted ball first lands at `range`. */
export function loftSpeed(range, angle = KICK.loftAngle) {
  if (LOFT_TABLE.angle !== angle) buildLoftTable(angle);
  const { speeds, ranges } = LOFT_TABLE;

  if (range <= ranges[0]) return speeds[0];
  const last = ranges.length - 1;
  if (range >= ranges[last]) return clamp(speeds[last], 0, KICK.loftMaxSpeed);

  // Ranges are monotonic in speed, so a linear scan/interpolate is exact enough.
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i] >= range) {
      const t = (range - ranges[i - 1]) / (ranges[i] - ranges[i - 1] || 1);
      return clamp(lerp(speeds[i - 1], speeds[i], t), KICK.loftMinSpeed * 0.4, KICK.loftMaxSpeed);
    }
  }
  return clamp(speeds[last], 0, KICK.loftMaxSpeed);
}

/**
 * Keep a pass target inside the field of play. Passing into touch is the single
 * biggest source of scrappy football, so every target goes through this.
 */
export function containTarget(x, z, marginSide = 3.5, marginEnd = 3.0) {
  return {
    x: clamp(x, -HALF_LENGTH + marginEnd, HALF_LENGTH - marginEnd),
    z: clamp(z, -(PITCH.width / 2) + marginSide, PITCH.width / 2 - marginSide),
  };
}

/** How crowded a player is — drives kick error and AI safety scoring. */
export function pressureOn(player, opponents, radius = 4.5) {
  let p = 0;
  for (let i = 0; i < opponents.length; i++) {
    const o = opponents[i];
    if (o.isKeeper) continue;
    const d = dist2(player.pos, o.pos);
    if (d < radius) p += 1 - d / radius;
  }
  return clamp(p, 0, 2.2);
}

/**
 * Assisted target selection. The player's stick/key direction defines a cone;
 * candidates inside it are scored by alignment, distance and lane safety.
 * Returns null when nothing sensible is available, so the kick stays manual.
 */
export function selectPassTarget(player, mates, opponents, dirX, dirZ, opts = {}) {
  const maxRange = opts.maxRange ?? KICK.passMaxRange;
  const cone = opts.cone ?? KICK.passCone;
  const lead = opts.lead ?? 0;
  const requireForward = opts.requireForward ?? false;

  const dl = Math.hypot(dirX, dirZ);
  const hasDir = dl > 0.15;
  const dx = hasDir ? dirX / dl : Math.sin(player.heading);
  const dz = hasDir ? dirZ / dl : Math.cos(player.heading);

  let best = null;
  let bestScore = -Infinity;

  for (let i = 0; i < mates.length; i++) {
    const m = mates[i];
    if (m === player) continue;
    if (m.isKeeper && opts.allowKeeper === false) continue;

    // Lead the target by its own velocity so passes go where runners will be.
    const tx = m.pos.x + m.vel.x * lead;
    const tz = m.pos.z + m.vel.z * lead;

    const ox = tx - player.pos.x;
    const oz = tz - player.pos.z;
    const d = Math.hypot(ox, oz);
    if (d < 1.6 || d > maxRange) continue;

    const alignment = (ox * dx + oz * dz) / d;
    const angle = Math.acos(clamp(alignment, -1, 1));
    if (angle > cone) continue;

    if (requireForward && (tx - player.pos.x) * player.attackDir < 2) continue;

    const lane = laneSafety(player.pos, { x: tx, z: tz }, opponents);
    if (lane <= 0.02) continue;

    // Prefer well-aligned, safe, progressive options at a comfortable range.
    const progress = ((tx - player.pos.x) * player.attackDir) / maxRange;
    const rangeScore = 1 - Math.abs(d - maxRange * 0.42) / maxRange;
    const score =
      alignment * 2.6 + lane * 1.9 + progress * 0.9 + rangeScore * 0.5 - (m.isKeeper ? 1.4 : 0);

    if (score > bestScore) {
      bestScore = score;
      best = { player: m, x: tx, z: tz, distance: d, lane, score };
    }
  }

  return best;
}

/**
 * Fraction of the passing lane that is free of opponents. 1 = clear, 0 = blocked.
 * Sampled rather than swept — cheap, and good enough to make AI passing readable.
 */
export function laneSafety(from, to, opponents, corridor = 1.5) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.5) return 1;
  const ux = dx / len;
  const uz = dz / len;

  let worst = 1;
  for (let i = 0; i < opponents.length; i++) {
    const o = opponents[i];
    const rx = o.pos.x - from.x;
    const rz = o.pos.z - from.z;
    const along = rx * ux + rz * uz;
    if (along < 0.4 || along > len + 0.8) continue;
    const perp = Math.abs(rx * uz - rz * ux);
    // Interceptors further along the lane have more time to step across.
    const effective = corridor + (along / len) * 1.5 + (o.isKeeper ? 0.9 : 0);
    if (perp < effective) {
      const block = 1 - perp / effective;
      worst = Math.min(worst, 1 - block);
    }
  }
  return clamp(worst, 0, 1);
}

/**
 * Build the velocity for a kick. `type` is 'pass' | 'through' | 'loft' | 'shot' | 'clear'.
 * Direction blends the player's raw input with the assisted target by `assist`.
 */
export function buildKick(player, ball, type, power, aimX, aimZ, target, pressure, rng) {
  const outVel = { x: 0, y: 0, z: 0 };
  let spin = 0;

  const al = Math.hypot(aimX, aimZ);
  let dirX = al > 0.15 ? aimX / al : Math.sin(player.heading);
  let dirZ = al > 0.15 ? aimZ / al : Math.cos(player.heading);

  let range = 14;
  if (target) {
    const tx = target.x - ball.pos.x;
    const tz = target.z - ball.pos.z;
    const tl = Math.hypot(tx, tz) || 1;
    range = tl;
    const assist =
      type === 'shot' ? KICK.assistBlendShot : KICK.assistBlendPass;
    // assist = manual weight; blend toward the assisted direction.
    dirX = lerp(tx / tl, dirX, assist);
    dirZ = lerp(tz / tl, dirZ, assist);
    const bl = Math.hypot(dirX, dirZ) || 1;
    dirX /= bl;
    dirZ /= bl;
  }

  const powerAttr = player.attrs.power;
  const err =
    KICK.baseError +
    KICK.pressureError * pressure * (1 - player.attrs.control * 0.35) +
    KICK.powerError * power;
  const errAngle = rng ? rng.gauss(err) : 0;
  const ca = Math.cos(errAngle);
  const sa = Math.sin(errAngle);
  const ex = dirX * ca - dirZ * sa;
  const ez = dirX * sa + dirZ * ca;
  dirX = ex;
  dirZ = ez;

  switch (type) {
    case 'pass': {
      // Power modulates the *arrival* pace, not a blind speed multiplier, so a
      // firm pass is harder to intercept without sailing past the receiver.
      let speed;
      if (target) {
        const arrival = lerp(2.8, 8.0, power);
        speed = groundPassSpeed(range, arrival) * lerp(0.99, 1.03, powerAttr - 0.9);
      } else {
        speed = lerp(KICK.passMinSpeed, KICK.passMaxSpeed, power) * powerAttr;
      }
      speed = clamp(speed, 4.5, KICK.passMaxSpeed);
      outVel.x = dirX * speed;
      outVel.z = dirZ * speed;
      outVel.y = 0;
      spin = errAngle * 6;
      break;
    }
    case 'through': {
      // A through ball must still be running when it reaches the space.
      let speed;
      if (target) {
        speed = groundPassSpeed(range, lerp(5.5, 9.5, power));
      } else {
        speed = lerp(KICK.throughMinSpeed, KICK.throughMaxSpeed, power);
      }
      speed = clamp(speed * powerAttr, 6, KICK.throughMaxSpeed);
      outVel.x = dirX * speed;
      outVel.z = dirZ * speed;
      outVel.y = 0;
      spin = errAngle * 5;
      break;
    }
    case 'loft': {
      const r = target ? range : lerp(14, 34, power);
      const speed = loftSpeed(r) * lerp(0.92, 1.1, power) * powerAttr;
      const ang = KICK.loftAngle;
      const h = Math.cos(ang) * speed;
      outVel.x = dirX * h;
      outVel.z = dirZ * h;
      outVel.y = Math.sin(ang) * speed;
      spin = errAngle * 8;
      break;
    }
    case 'clear': {
      const speed = KICK.loftMaxSpeed * powerAttr;
      const ang = 0.62;
      outVel.x = dirX * Math.cos(ang) * speed;
      outVel.z = dirZ * Math.cos(ang) * speed;
      outVel.y = Math.sin(ang) * speed;
      spin = errAngle * 4;
      break;
    }
    case 'shot':
    default: {
      const speed = clamp(
        lerp(KICK.shotMinSpeed, KICK.shotMaxSpeed, power) * powerAttr,
        KICK.shotMinSpeed,
        KICK.shotMaxSpeed
      );
      // Loft scales with power but stays low enough that shots are usually on target.
      let lift = KICK.shotLoftBase + KICK.shotLoftPerPower * power;
      // Close range shots stay flatter so they don't sail.
      const distToGoal = Math.abs(HALF_LENGTH * player.attackDir - ball.pos.x);
      lift *= clamp(distToGoal / 16, 0.35, 1.25);
      outVel.x = dirX * speed;
      outVel.z = dirZ * speed;
      outVel.y = lift * speed;
      spin = errAngle * 11 + (rng ? rng.spread(1.4) : 0);
      break;
    }
  }

  return { vel: outVel, spin };
}

/**
 * Pick an aim point inside the goal mouth for a shot. Aims away from the keeper
 * and keeps the ball inside the frame so shots are believable rather than random.
 */
export function shotAimPoint(player, keeper, rng, skill = 1) {
  const goalX = HALF_LENGTH * player.attackDir;
  const inset = HALF_GOAL * 0.82;
  let z;
  if (keeper) {
    // Aim to whichever side of the keeper has more open goal.
    const left = -inset - keeper.pos.z;
    const right = inset - keeper.pos.z;
    const pickRight = Math.abs(right) > Math.abs(left);
    z = pickRight ? inset : -inset;
    // Pull back toward centre a little when the keeper is well positioned.
    z *= lerp(0.72, 1, clamp(Math.abs(keeper.pos.z) / inset + 0.4, 0, 1));
  } else {
    z = rng ? rng.spread(inset * 0.7) : 0;
  }
  const noise = rng ? rng.gauss(0.55) * (2 - skill) : 0;
  return { x: goalX, z: clamp(z + noise, -HALF_GOAL * 0.97, HALF_GOAL * 0.97) };
}
