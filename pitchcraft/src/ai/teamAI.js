import { AI, PLAYER, KICK, BALL, HALF_LENGTH, HALF_WIDTH, HALF_GOAL } from '../core/config.js';

const BALL_RADIUS = BALL.radius;
import { PlayerState } from '../sim/player.js';
import { clamp, lerp, dist2, distSq2, smoothstep } from '../core/vec.js';
import { laneSafety, pressureOn, buildKick, shotAimPoint, containTarget } from '../sim/kicks.js';
import { EV } from '../core/events.js';

const TeamPhase = {
  ATTACK: 'attack',
  DEFEND: 'defend',
  LOOSE: 'loose',
};

/**
 * Deterministic, role-based team AI.
 *
 * Structure:
 *   1. Read the game state and classify the team phase.
 *   2. Assign each outfield player a job (press / mark / cover / support / run).
 *   3. Convert the job into a target point, then steer with spacing separation.
 *   4. The ball carrier runs a separate utility pass/shoot/dribble decision.
 *
 * No randomness drives *whether* a decision is sensible — the RNG only breaks
 * ties and adds execution error, so behaviour stays readable and reproducible.
 */
export class TeamAI {
  constructor({ world, teamId, bus, rng, difficulty = AI.difficulty }) {
    this.world = world;
    this.teamId = teamId;
    this.bus = bus;
    this.rng = rng;
    this.difficulty = { ...difficulty };
    this.phase = TeamPhase.LOOSE;
    this.decisionTimer = 0;
    this.assignments = new Map();
    this.attackDir = world.teams[teamId][0].attackDir;
  }

  get mates() {
    return this.world.teams[this.teamId];
  }

  get opponents() {
    return this.world.teams[1 - this.teamId];
  }

  /**
   * @param {number} dt
   * @param {Player|null} humanControlled player under direct human control (skipped)
   */
  update(dt, humanControlled = null) {
    const world = this.world;
    const ball = world.ball;

    this.decisionTimer -= dt;
    const rethink = this.decisionTimer <= 0;
    if (rethink) this.decisionTimer = AI.decisionInterval;

    const owner = ball.owner;
    if (owner && owner.team === this.teamId) this.phase = TeamPhase.ATTACK;
    else if (owner) this.phase = TeamPhase.DEFEND;
    else this.phase = TeamPhase.LOOSE;

    // Job assignment must know who the human has taken over, so his job goes to
    // somebody else instead of simply going undone.
    this.humanControlled = humanControlled;
    if (rethink) this.assignJobs();

    for (const p of this.mates) {
      if (p === humanControlled) continue;
      if (p.isKeeper) continue; // handled by GoalkeeperAI
      if (p.state === PlayerState.STUMBLE || p.state === PlayerState.FROZEN) continue;
      if (p.state === PlayerState.CELEBRATE) continue;

      if (ball.owner === p) {
        this.driveCarrier(p, dt);
      } else {
        this.driveOffBall(p, dt);
      }
    }
  }

  // ---------------------------------------------------------------- jobs ---

  /**
   * Assign one job per outfield player. Jobs are recomputed on a fixed cadence
   * (not every frame) which both saves work and stops players flip-flopping.
   */
  assignJobs() {
    const ball = this.world.ball;
    const mates = this.mates;
    const opps = this.opponents;
    this.assignments.clear();

    // The human-controlled player is not available to carry out a job: he does
    // whatever his human does. Leaving him in the pool meant the AI would hand
    // him "press" or "chase", then skip him when driving players — so nobody
    // pressed, nobody chased, and the team defended a man short. Excluding him
    // here makes a real player take the job instead.
    const outfield = mates.filter((p) => !p.isKeeper && p !== this.humanControlled);

    // Sort by distance to ball — the front of this list does the chasing.
    const byBall = [...outfield].sort((a, b) => distSq2(a.pos, ball.pos) - distSq2(b.pos, ball.pos));

    if (this.phase === TeamPhase.ATTACK) {
      const carrier = ball.owner;
      for (const p of outfield) {
        if (p === carrier) {
          this.assignments.set(p, 'carry');
          continue;
        }
        // Forward players and anyone ahead of the ball look to run; the rest support.
        const ahead = (p.pos.x - ball.pos.x) * this.attackDir;
        if (p.role === 'ST' || (ahead > -2 && (p.role === 'WM' || p.role === 'CM'))) {
          this.assignments.set(p, 'run');
        } else if (p.role === 'CB' || p.role === 'FB') {
          this.assignments.set(p, 'shape');
        } else {
          this.assignments.set(p, 'support');
        }
      }
      return;
    }

    // A loose ball always gets exactly one dedicated chaser from this team,
    // chosen by time-to-intercept rather than raw distance. Without this, a pass
    // to a team-mate who isn't the globally-nearest player is simply never
    // collected — which is what kept completion rates down around 40%.
    let chaser = null;
    if (this.phase === TeamPhase.LOOSE) {
      chaser = this.pickChaser(outfield);
      if (chaser) this.assignments.set(chaser, 'chase');
    }

    // Defending or contesting a loose ball.
    let pressers = 0;
    const maxPress = this.phase === TeamPhase.LOOSE ? 1 : AI.pressersMax;

    // Mark the most dangerous opponents: those closest to our goal, excluding keeper.
    const goalX = -HALF_LENGTH * this.attackDir;
    const threats = opps
      .filter((o) => !o.isKeeper)
      .sort((a, b) => Math.abs(a.pos.x - goalX) - Math.abs(b.pos.x - goalX));
    const marked = new Set();

    for (const p of byBall) {
      if (this.assignments.get(p) === 'chase') continue;
      const d = dist2(p.pos, ball.pos);
      const canPress =
        pressers < maxPress &&
        (d < AI.pressRadius || pressers === 0) &&
        // Deepest defenders don't abandon the line to chase unless it's very close.
        (p.role !== 'CB' || d < 9 || pressers === 0);

      if (canPress) {
        this.assignments.set(p, 'press');
        pressers++;
        continue;
      }

      if (p.role === 'CB' || p.role === 'FB') {
        // Take the nearest unmarked threat in our defensive third.
        let best = null;
        let bestD = Infinity;
        for (const t of threats) {
          if (marked.has(t)) continue;
          const dd = distSq2(p.pos, t.pos);
          if (dd < bestD) {
            bestD = dd;
            best = t;
          }
        }
        if (best && Math.sqrt(bestD) < AI.markRadius * 1.8) {
          marked.add(best);
          p.ai.markTarget = best;
          this.assignments.set(p, 'mark');
          continue;
        }
      }

      this.assignments.set(p, 'cover');
    }
  }

  /**
   * Choose who goes for a loose ball. Scored by estimated time to reach the
   * ball's future path, with a bonus for the intended receiver of our own pass
   * so deliberate passes get collected by the player they were aimed at.
   */
  pickChaser(outfield) {
    const ball = this.world.ball;
    const intended = this.intendedReceiver(outfield);

    let best = null;
    let bestT = Infinity;
    for (const p of outfield) {
      if (p.state === PlayerState.STUMBLE) continue;
      const meet = this.interceptPoint(p);
      const d = Math.hypot(meet.x - p.pos.x, meet.z - p.pos.z);
      let t = d / Math.max(p.maxSpeed, 3);
      if (p === intended) t *= 0.55;
      if (t < bestT) {
        bestT = t;
        best = p;
      }
    }
    return best;
  }

  /** The team-mate a live pass from this team was aimed at, if any. */
  intendedReceiver(outfield) {
    const ball = this.world.ball;
    if (!ball.inFlightFrom || ball.inFlightFrom.team !== this.teamId) return null;
    if (!ball.intentTarget) return null;
    let best = null;
    let bestD = Infinity;
    for (const p of outfield) {
      const d = Math.hypot(p.pos.x - ball.intentTarget.x, p.pos.z - ball.intentTarget.z);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return bestD < 12 ? best : null;
  }

  // -------------------------------------------------------------- off ball --

  driveOffBall(p, dt) {
    const job = this.assignments.get(p) || 'cover';
    const ball = this.world.ball;
    let target;
    let sprint = false;
    let speed = 1;

    switch (job) {
      case 'chase':
        target = this.interceptPoint(p);
        sprint = true;
        break;
      case 'press':
        target = this.pressTarget(p);
        sprint = dist2(p.pos, ball.pos) > 4.5;
        break;
      case 'mark':
        target = this.markTarget(p);
        sprint = dist2(p.pos, target) > 7;
        break;
      case 'run':
        target = this.runTarget(p, dt);
        sprint = true;
        break;
      case 'support':
        target = this.supportTarget(p);
        sprint = dist2(p.pos, target) > 11;
        break;
      case 'shape':
      case 'cover':
      default:
        target = this.shapeTarget(p);
        sprint = dist2(p.pos, target) > 13;
        break;
    }

    this.steer(p, target, speed, sprint, dt);
    this.maybeIntercept(p, dt);
  }

  /** Press the carrier, but arrive slightly goal-side rather than head-on. */
  pressTarget(p) {
    const ball = this.world.ball;
    const owner = ball.owner;
    const goalX = -HALF_LENGTH * this.attackDir;
    const bx = owner ? owner.pos.x + owner.vel.x * 0.22 : ball.pos.x + ball.vel.x * 0.25;
    const bz = owner ? owner.pos.z + owner.vel.z * 0.22 : ball.pos.z + ball.vel.z * 0.25;

    const gx = goalX - bx;
    const gz = 0 - bz;
    const gl = Math.hypot(gx, gz) || 1;
    const standoff = owner ? 1.05 : 0.3;
    return {
      x: bx + (gx / gl) * standoff,
      z: bz + (gz / gl) * standoff,
    };
  }

  markTarget(p) {
    const t = p.ai.markTarget;
    const ball = this.world.ball;
    if (!t) return this.shapeTarget(p);
    const goalX = -HALF_LENGTH * this.attackDir;
    // Sit between the marked player and our goal, biased toward the ball side.
    const gx = goalX - t.pos.x;
    const gz = 0 - t.pos.z;
    const gl = Math.hypot(gx, gz) || 1;
    const gap = clamp(dist2(t.pos, ball.pos) * 0.16, 1.5, 3.4);
    return {
      x: t.pos.x + (gx / gl) * gap + t.vel.x * 0.16,
      z: t.pos.z + (gz / gl) * gap + t.vel.z * 0.16,
    };
  }

  /** Attacking runs: hold a lane, then break beyond the last defender. */
  runTarget(p, dt) {
    const ball = this.world.ball;
    const dir = this.attackDir;
    const opps = this.opponents;

    // Offside-free, but we still respect the last defender so runs look purposeful.
    let lastDefX = -HALF_LENGTH * dir;
    for (const o of opps) {
      if (o.isKeeper) continue;
      if ((o.pos.x - lastDefX) * dir < 0) lastDefX = o.pos.x;
    }

    p.ai.runTimer -= dt;
    if (p.ai.runTimer <= 0) {
      p.ai.runTimer = this.rng.range(1.1, 2.6);
      // Choose a lane offset so two runners don't stack.
      p.ai.runLane = p.formationSlot.z * HALF_WIDTH * 0.78 + this.rng.spread(4.5);
    }

    const carrier = ball.owner;
    const carrierFacingForward = carrier ? Math.cos(carrier.heading - (dir > 0 ? Math.PI / 2 : -Math.PI / 2)) > 0.1 : false;

    // Depth: sit just behind the last defender, push beyond when the carrier can play it.
    const push = carrierFacingForward ? 3.4 : -1.6;
    let x = lastDefX + dir * push;
    // Never run so far that the whole team detaches from the ball.
    const maxAhead = ball.pos.x + dir * 24;
    if ((x - maxAhead) * dir > 0) x = maxAhead;

    const z = clamp(p.ai.runLane, -HALF_WIDTH + 2.2, HALF_WIDTH - 2.2);
    return {
      x: clamp(x, -HALF_LENGTH + 3, HALF_LENGTH - 3),
      z,
    };
  }

  /** Support the carrier: offer an angle, stay out of the passing shadow. */
  supportTarget(p) {
    const ball = this.world.ball;
    const carrier = ball.owner;
    const dir = this.attackDir;
    const base = this.shapeTarget(p);
    if (!carrier) return base;

    const d = dist2(p.pos, carrier.pos);
    // Pull toward the ball but keep a sensible separation.
    const want = clamp(AI.supportRadius * 0.62, 8, 16);
    const dx = p.pos.x - carrier.pos.x;
    const dz = p.pos.z - carrier.pos.z;
    const l = Math.hypot(dx, dz) || 1;

    // Blend the formation slot with an offered angle beside/behind the ball.
    const ox = carrier.pos.x + (dx / l) * want - dir * 1.5;
    const oz = carrier.pos.z + (dz / l) * want;

    return {
      x: lerp(base.x, ox, 0.55),
      z: lerp(base.z, oz, 0.6),
    };
  }

  /** Default: formation slot translated by ball position and team phase. */
  shapeTarget(p) {
    const ball = this.world.ball;
    const dir = this.attackDir;
    const lineHeight =
      this.phase === TeamPhase.ATTACK
        ? AI.lineHeightAttack
        : this.phase === TeamPhase.DEFEND
          ? AI.lineHeightDefend
          : 0;

    const base = this.world.slotPosition(p, lineHeight, AI.compactness);

    // Shift the whole block toward the ball, more laterally than longitudinally.
    const ballDepth = (ball.pos.x / HALF_LENGTH) * dir; // -1 own goal .. +1 their goal
    const depthShift = ballDepth * HALF_LENGTH * 0.3 * dir;
    const lateralShift = (ball.pos.z / HALF_WIDTH) * HALF_WIDTH * 0.28;

    let x = base.x + depthShift;
    let z = base.z + lateralShift;

    // Defenders never let the ball get goal-side of them without cause.
    if (this.phase === TeamPhase.DEFEND && (p.role === 'CB' || p.role === 'FB')) {
      const goalX = -HALF_LENGTH * dir;
      const limit = ball.pos.x - dir * 1.5;
      if ((x - limit) * dir > 0) x = limit;
      if ((x - goalX) * dir < 3) x = goalX + dir * 3;
    }

    return {
      x: clamp(x, -HALF_LENGTH + 2.5, HALF_LENGTH - 2.5),
      z: clamp(z, -HALF_WIDTH + 1.8, HALF_WIDTH - 1.8),
    };
  }

  /**
   * Earliest point on the ball's future path this player can actually reach.
   *
   * Rolls the ball forward with the same drag/gravity model the integrator uses
   * (coarse steps are plenty for a decision made every 0.12s) and returns the
   * first sample the player can beat. Handles lofted balls by chasing the
   * landing spot rather than a point under the ball's current position.
   */
  interceptPoint(p) {
    const ball = this.world.ball;
    const speed = Math.hypot(ball.vel.x, ball.vel.z);
    if (speed < 1.0 && ball.pos.y < 0.5) return { x: ball.pos.x, z: ball.pos.z };

    const dt = 0.05;
    const mySpeed = Math.max(p.maxSpeed, 3);
    let x = ball.pos.x;
    let y = ball.pos.y;
    let z = ball.pos.z;
    let vx = ball.vel.x;
    let vy = ball.vel.y;
    let vz = ball.vel.z;

    let fallback = { x, z };

    for (let t = dt; t <= 2.6; t += dt) {
      const airborne = y > BALL_RADIUS + 1e-4 || vy > 1e-4;
      if (airborne) {
        vy -= 9.81 * dt;
        const s = Math.hypot(vx, vy, vz);
        if (s > 0.01) {
          const k = Math.max(0, 1 - 0.06 * dt);
          vx *= k;
          vy *= k;
          vz *= k;
        }
      } else {
        const gs = Math.hypot(vx, vz);
        if (gs > 1e-4) {
          let ns = gs * Math.exp(-0.62 * dt) - 0.55 * dt;
          if (ns < 0.06) ns = 0;
          const k = ns / gs;
          vx *= k;
          vz *= k;
        }
        vy = 0;
        y = BALL_RADIUS;
      }
      x += vx * dt;
      y += vy * dt;
      z += vz * dt;
      if (y < BALL_RADIUS) {
        y = BALL_RADIUS;
        vy = Math.abs(vy) * 0.52;
        vx *= 0.78;
        vz *= 0.78;
      }

      fallback = { x, z };

      // Can we be there in time? Only meet it at a controllable height.
      const d = Math.hypot(x - p.pos.x, z - p.pos.z);
      if (d / mySpeed <= t && y < 1.6) {
        return {
          x: clamp(x, -HALF_LENGTH - 1, HALF_LENGTH + 1),
          z: clamp(z, -HALF_WIDTH - 1, HALF_WIDTH + 1),
        };
      }
    }

    return {
      x: clamp(fallback.x, -HALF_LENGTH - 1, HALF_LENGTH + 1),
      z: clamp(fallback.z, -HALF_WIDTH - 1, HALF_WIDTH + 1),
    };
  }

  /** Slide-tackle the carrier when the odds are good. */
  maybeIntercept(p, dt) {
    const ball = this.world.ball;
    const owner = ball.owner;
    if (!owner || owner.team === this.teamId) return;
    if (p.tackleCooldown > 0 || p.state !== PlayerState.RUN) return;

    const d = dist2(p.pos, ball.pos);
    if (d > PLAYER.tackleRange * 0.92) return;

    const aggression = (p.attrs.aggression ?? 0.7) * this.difficulty.aggression;
    // Only commit when we are roughly goal-side or level, otherwise we get spun.
    const goalX = -HALF_LENGTH * this.attackDir;
    const goalSide = (p.pos.x - owner.pos.x) * Math.sign(goalX) >= -0.8;
    const odds = aggression * (goalSide ? 1 : 0.4) * clamp(1.4 - d / PLAYER.tackleRange, 0, 1);

    // Rate is per second, so the outcome doesn't change with the physics step.
    if (this.rng.next() < odds * dt * (this.difficulty.tackleRate ?? AI.tackleRate)) {
      p.startTackle(ball.pos.x - p.pos.x, ball.pos.z - p.pos.z);
      this.bus.emit(EV.TACKLE, { player: p, attempt: true, pos: { ...p.pos } });
    }
  }

  // -------------------------------------------------------------- carrier --

  driveCarrier(p, dt) {
    const world = this.world;
    const ball = world.ball;
    const dir = this.attackDir;
    const opps = this.opponents;
    const goalX = HALF_LENGTH * dir;

    p.ai.decisionTimer -= dt;

    const pressure = pressureOn(p, opps, 5.0);
    const distToGoal = Math.hypot(goalX - p.pos.x, 0 - p.pos.z);
    const keeper = world.keeperOf(1 - this.teamId);

    // --- Shoot? ---
    if (p.kickCooldown <= 0 && p.ai.decisionTimer <= 0) {
      const aim = shotAimPoint(p, keeper, this.rng, this.difficulty.passAccuracy);
      const shotLane = laneSafety(p.pos, aim, opps, 1.1);
      const angleQuality = 1 - clamp(Math.abs(p.pos.z) / (HALF_WIDTH * 0.9), 0, 1) * 0.75;
      const rangeQuality = smoothstep(AI.shootRangeBase + 9, 6, distToGoal);
      const shootUtility = rangeQuality * angleQuality * shotLane * (1 + pressure * 0.25);

      if (shootUtility > (this.difficulty.shootConfidence ?? AI.shootConfidence)) {
        this.executeKick(p, 'shot', clamp(0.55 + distToGoal / 34, 0.4, 1), aim, pressure);
        return;
      }
    }

    // --- Pass? ---
    // A carrier must settle on the ball before looking to release it, unless
    // it's genuinely under pressure. Without this the AI offloads within a
    // couple of frames of every touch and the ball is permanently in flight.
    const carryTime = world.time - (p.lastReceiveTime ?? -99);
    const settled = carryTime > AI.minCarryTime || pressure > AI.pressureRelease;

    if (p.kickCooldown <= 0 && p.ai.decisionTimer <= 0 && settled) {
      p.ai.decisionTimer = AI.decisionInterval;
      const best = this.bestPass(p, pressure);
      const threshold = pressure > 0.9 ? AI.passThresholdPressed : AI.passThreshold;
      if (best && best.utility > threshold) {
        this.executeKick(p, best.type, best.power, { x: best.x, z: best.z }, pressure);
        return;
      }
      // Under heavy pressure with nothing on, clear it rather than lose it cheaply.
      if (pressure > 1.5 && Math.abs(p.pos.x - (-HALF_LENGTH * dir)) < HALF_LENGTH * 0.55) {
        // Hoof it upfield and slightly wide — but still aimed to land in play.
        const wide = Math.sign(p.pos.z || 1) * HALF_WIDTH * 0.55;
        const aim = containTarget(p.pos.x + dir * 26, wide, 4.5, 5.0);
        this.executeKick(p, 'clear', 1, aim, pressure);
        return;
      }
    }

    // --- Dribble ---
    this.dribble(p, pressure, dt);
  }

  /** Score every available pass and return the best. */
  bestPass(p, pressure) {
    const opps = this.opponents;
    const mates = this.mates;
    const dir = this.attackDir;
    const goalX = HALF_LENGTH * dir;

    let best = null;

    for (const m of mates) {
      if (m === p) continue;
      if (m.state === PlayerState.STUMBLE) continue;

      for (const type of ['pass', 'through', 'loft']) {
        const lead = type === 'through' ? 0.85 : type === 'loft' ? 0.55 : 0.28;
        let tx = m.pos.x + m.vel.x * lead * 3;
        let tz = m.pos.z + m.vel.z * lead * 3;

        if (type === 'through') {
          // Play it into the space ahead of the runner.
          tx += dir * KICK.throughLead;
          // Only worth it if the receiver is actually moving forward.
          if (m.vel.x * dir < 1.2) continue;
        }

        // Never aim a pass at a point the ball cannot stay in play at. Margins
        // account for roll-out *past* the target: a pass still travelling at its
        // arrival pace, and a loft that lands and then bounces on.
        const margin =
          type === 'loft'
            ? { side: 9.0, end: 8.0 }
            : type === 'through'
              ? { side: 6.5, end: 7.0 }
              : { side: 5.5, end: 4.5 };
        const safe = containTarget(tx, tz, margin.side, margin.end);
        tx = safe.x;
        tz = safe.z;

        const d = Math.hypot(tx - p.pos.x, tz - p.pos.z);
        if (d < 3 || d > KICK.passMaxRange) continue;
        if (type === 'loft' && d < 12) continue;
        if (type === 'pass' && d > 26) continue;

        // Lofted balls fly over most traffic.
        const lane =
          type === 'loft'
            ? clamp(laneSafety(p.pos, { x: tx, z: tz }, opps, 0.6) + 0.5, 0, 1)
            : laneSafety(p.pos, { x: tx, z: tz }, opps, type === 'through' ? 1.2 : 1.5);

        if (lane < 0.18) continue;

        // Utility terms are measured against where the *receiver* ends up, not
        // the aim point. Scoring a through ball on its own 7.5m lead made the AI
        // rate every through ball as more progressive than the pass beneath it.
        const progress = clamp(((m.pos.x - p.pos.x) * dir) / 26, -1, 1);
        const receiverSpace = this.spaceAround(tx, tz, opps);
        const goalThreat = smoothstep(46, 12, Math.hypot(goalX - m.pos.x, m.pos.z)) * (m.isKeeper ? 0 : 1);
        const keeperPenalty = m.isKeeper ? 0.9 : 0;
        const backPass = progress < -0.25 ? 0.25 : 0;

        let utility =
          AI.wProgress * progress +
          AI.wSafety * (lane - 0.5) +
          AI.wSpace * (receiverSpace - 0.4) +
          AI.wGoalThreat * goalThreat * 0.6 -
          keeperPenalty -
          backPass;

        // Under pressure a safe outlet becomes far more valuable.
        if (pressure > 0.8) utility += (lane - 0.4) * 1.2 + (m.isKeeper ? 0.5 : 0);

        // Type preference: the simple pass is the default. The ambitious options
        // must earn their place by actually creating something.
        if (type === 'pass') {
          utility += AI.passBias;
        } else if (type === 'through') {
          // Only valuable if it genuinely puts the receiver in behind.
          const spaceBeyond = this.spaceAround(tx, tz, opps, 9);
          const behindLine = this.isBehindDefence(tx, dir) ? 1 : 0;
          utility += AI.throughBias + spaceBeyond * 0.55 + behindLine * 0.7;
        } else if (type === 'loft') {
          // Lofts are for switching play or beating a packed lane, not tempo.
          const groundBlocked = 1 - laneSafety(p.pos, { x: tx, z: tz }, opps, 1.5);
          utility += AI.loftBias + groundBlocked * 0.8 + clamp((d - 18) / 22, 0, 1) * 0.5;
        }

        utility *= this.difficulty.passAccuracy;

        if (!best || utility > best.utility) {
          const power =
            type === 'loft'
              ? clamp(d / 30, 0.4, 1)
              : type === 'through'
                ? clamp(d / 26, 0.45, 1)
                : clamp(d / 24, 0.3, 1);
          best = { player: m, x: tx, z: tz, type, utility, power, lane, distance: d };
        }
      }
    }

    return best;
  }

  /** True if `x` is beyond the opposition's deepest outfield defender. */
  isBehindDefence(x, dir) {
    let lastDefX = -HALF_LENGTH * dir;
    for (const o of this.opponents) {
      if (o.isKeeper) continue;
      if ((o.pos.x - lastDefX) * dir < 0) lastDefX = o.pos.x;
    }
    return (x - lastDefX) * dir > 0;
  }

  /** 0..1 measure of how free a point is. */
  spaceAround(x, z, opps, radius = 7) {
    let crowd = 0;
    for (const o of opps) {
      if (o.isKeeper) continue;
      const d = Math.hypot(o.pos.x - x, o.pos.z - z);
      if (d < radius) crowd += 1 - d / radius;
    }
    return clamp(1 - crowd * 0.55, 0, 1);
  }

  dribble(p, pressure, dt) {
    const dir = this.attackDir;
    const goalX = HALF_LENGTH * dir;
    const opps = this.opponents;

    // Head for goal, but steer around the densest pressure.
    let tx = goalX - dir * 4;
    let tz = clamp(p.pos.z * 0.55, -HALF_GOAL * 1.4, HALF_GOAL * 1.4);

    let avoidX = 0;
    let avoidZ = 0;
    for (const o of opps) {
      const dx = p.pos.x - o.pos.x;
      const dz = p.pos.z - o.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 7 && d > 0.2) {
        const w = (1 - d / 7) ** 2 * 9;
        avoidX += (dx / d) * w;
        avoidZ += (dz / d) * w;
      }
    }

    let mx = tx - p.pos.x + avoidX;
    let mz = tz - p.pos.z + avoidZ;
    const l = Math.hypot(mx, mz) || 1;
    mx /= l;
    mz /= l;

    // Keep the ball away from the touchline while dribbling.
    if (Math.abs(p.pos.z) > HALF_WIDTH - 4) mz -= Math.sign(p.pos.z) * 0.5;

    const sprint = pressure < 0.55 && Math.abs(p.pos.x - goalX) > 12;
    p.move(mx, mz, 1, sprint);
  }

  /** Fire a kick and emit the matching event. */
  executeKick(p, type, power, target, pressure) {
    const world = this.world;
    const ball = world.ball;
    const aimX = target.x - ball.pos.x;
    const aimZ = target.z - ball.pos.z;

    const { vel, spin } = buildKick(
      p,
      ball,
      type,
      clamp(power, 0, 1),
      aimX,
      aimZ,
      target,
      pressure,
      this.rng,
      this.difficulty.errorScale ?? 1
    );

    ball.owner = null;
    p.hasBall = false;
    p.kickCooldown = KICK.kickCooldown;
    p.possessionLock = PLAYER.possessionLockout;
    p.ai.decisionTimer = 0.25;
    p.triggerKickAnim(type);
    // Face the kick.
    p.heading = Math.atan2(vel.x, vel.z);
    ball.launch(p, vel, spin, type, target);

    if (type === 'shot') {
      this.bus.emit(EV.SHOT, { player: p, target, power, pos: { ...ball.pos } });
    } else {
      this.bus.emit(EV.PASS, { player: p, type, target, power, pos: { ...ball.pos } });
    }
    this.bus.emit(EV.KICK, { player: p, type, power, pos: { ...ball.pos } });
  }

  // -------------------------------------------------------------- steering --

  /** Seek a target with teammate separation so the shape never collapses. */
  steer(p, target, speedScale, sprint, dt) {
    let dx = target.x - p.pos.x;
    let dz = target.z - p.pos.z;
    const d = Math.hypot(dx, dz);

    // Separation from teammates keeps players out of identical spaces.
    let sx = 0;
    let sz = 0;
    for (const m of this.mates) {
      if (m === p || m.isKeeper) continue;
      const ex = p.pos.x - m.pos.x;
      const ez = p.pos.z - m.pos.z;
      const ed = Math.hypot(ex, ez);
      if (ed < AI.spacing && ed > 0.05) {
        const w = (1 - ed / AI.spacing) * AI.spacingForce;
        sx += (ex / ed) * w;
        sz += (ez / ed) * w;
      }
    }

    if (d < 0.9) {
      // Arrived: hold position, but still respect separation.
      const sl = Math.hypot(sx, sz);
      if (sl > 0.35) {
        p.move(sx / sl, sz / sl, 0.35, false);
      } else {
        p.stop();
        // Face the ball while idle so the shape reads correctly.
        const ball = this.world.ball;
        p.facing = Math.atan2(ball.pos.x - p.pos.x, ball.pos.z - p.pos.z);
      }
      return;
    }

    dx /= d;
    dz /= d;
    // Blend separation in more strongly when we're already near the target.
    const sepWeight = clamp(1.4 - d / 8, 0.25, 1.2);
    let mx = dx + sx * sepWeight;
    let mz = dz + sz * sepWeight;
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml;
    mz /= ml;

    // Ease off near the target so players settle instead of oscillating.
    const scale = clamp(d / 3.2, 0.28, 1) * speedScale;
    p.move(mx, mz, scale, sprint && d > 3.5 && !p.exhausted);
  }
}

export { TeamPhase };
