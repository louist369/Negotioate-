import { World } from '../sim/world.js';
import { TeamAI } from '../ai/teamAI.js';
import { GoalkeeperAI } from '../ai/goalkeeperAI.js';
import { PlayerState } from '../sim/player.js';
import { EventBus, EV } from '../core/events.js';
import { Rng } from '../core/rng.js';
import { MATCH, PITCH, BALL, PLAYER, AI, TEAMS, HALF_LENGTH, HALF_WIDTH, HALF_GOAL } from '../core/config.js';
import { clamp, dist2 } from '../core/vec.js';
import { buildKick, laneSafety } from '../sim/kicks.js';

export const Phase = {
  KICKOFF: 'kickoff',
  PLAY: 'play',
  GOAL: 'goal',
  RESTART: 'restart',
  FULL_TIME: 'fullTime',
};

export const RestartType = {
  KICKOFF: 'kickoff',
  THROW_IN: 'throwIn',
  CORNER: 'corner',
  GOAL_KICK: 'goalKick',
};

/**
 * Owns the match: phases, clock, score and the laws we implement (out of play,
 * goals, restarts). Drives the world plus both AI brains each tick.
 *
 * The human controller is injected — the match never imports input or rendering.
 */
export class Match {
  constructor({ seed = 20260731, humanTeam = 0, formation = '7v7', bus = null, difficulty } = {}) {
    this.bus = bus || new EventBus();
    this.rng = new Rng(seed);
    this.seed = seed;
    this.humanTeam = humanTeam;
    this.world = new World({ bus: this.bus, rng: this.rng, formation });

    const diff = { ...AI.difficulty, ...(difficulty || {}) };
    this.teamAI = [
      new TeamAI({ world: this.world, teamId: 0, bus: this.bus, rng: this.rng, difficulty: diff }),
      new TeamAI({ world: this.world, teamId: 1, bus: this.bus, rng: this.rng, difficulty: diff }),
    ];
    this.keeperAI = [
      new GoalkeeperAI({ world: this.world, teamId: 0, bus: this.bus, rng: this.rng, difficulty: diff }),
      new GoalkeeperAI({ world: this.world, teamId: 1, bus: this.bus, rng: this.rng, difficulty: diff }),
    ];

    this.humanController = null;

    this.score = [0, 0];
    this.stats = [this.blankStats(), this.blankStats()];
    this.clock = 0;
    this.duration = MATCH.durationSeconds;
    this.phase = Phase.KICKOFF;
    this.phaseTime = 0;
    this.paused = false;

    this.restart = null;
    this.lastGoal = null;
    this.possessionTeam = null;
    this.possessionTimer = [0, 0];

    this.bindStats();
    this.setupKickoff(this.rng.chance(0.5) ? 0 : 1);
  }

  /**
   * Match statistics are accumulated from the event bus rather than at each call
   * site. Incrementing them inside the human controller meant every AI shot and
   * tackle went uncounted, and the full-time panel reported zeroes.
   */
  bindStats() {
    this.bus.on(EV.SHOT, (e) => {
      if (e.player) this.stats[e.player.team].shots++;
    });
    this.bus.on(EV.PASS, (e) => {
      if (e.player) this.stats[e.player.team].passes++;
    });
    this.bus.on(EV.TACKLE, (e) => {
      // Count committed attempts; `success` events are the resolution of one.
      if (e.attempt && e.player) this.stats[e.player.team].tackles++;
    });
    // Only the resolved save counts. `attempt: true` is the dive commit, and a
    // caught save also emits CATCH — counting either would double up.
    this.bus.on(EV.SAVE, (e) => {
      if (!e.attempt && e.keeper) this.stats[e.keeper.team].saves++;
    });
    this.bus.on(EV.POSSESSION, (e) => {
      // A completed pass is one collected by a team-mate of the passer.
      const from = this.world.ball.inFlightFrom;
      if (e.player && from && from.team === e.player.team && from !== e.player) {
        this.stats[e.player.team].passesCompleted++;
      }
    });
  }

  blankStats() {
    return { shots: 0, onTarget: 0, passes: 0, passesCompleted: 0, tackles: 0, saves: 0, corners: 0, possession: 0 };
  }

  attachHumanController(controller) {
    this.humanController = controller;
  }

  get ball() {
    return this.world.ball;
  }

  get timeRemaining() {
    return Math.max(0, this.duration - this.clock);
  }

  get isOver() {
    return this.phase === Phase.FULL_TIME;
  }

  // ------------------------------------------------------------- lifecycle --

  /** Full reset — used by "play again". Reuses the same objects, no leaks. */
  resetMatch(seed = null) {
    if (seed !== null) this.seed = seed;
    this.rng.reset(this.seed);
    this.score[0] = 0;
    this.score[1] = 0;
    this.stats = [this.blankStats(), this.blankStats()];
    this.clock = 0;
    this.phase = Phase.KICKOFF;
    this.phaseTime = 0;
    this.paused = false;
    this.restart = null;
    this.lastGoal = null;
    this.possessionTimer = [0, 0];
    for (const k of this.keeperAI) k.reset();
    this.world.ball.reset();
    this.setupKickoff(this.rng.chance(0.5) ? 0 : 1);
    this.bus.emit(EV.MATCH_RESET, { seed: this.seed });
  }

  setupKickoff(team) {
    const world = this.world;
    const ball = world.ball;
    ball.reset(0, 0);
    ball.frozen = true;

    for (let t = 0; t < 2; t++) {
      const dir = TEAMS[t].attackDir;
      for (const p of world.teams[t]) {
        const slot = world.slotPosition(p, t === team ? 0.02 : -0.06, 0.95);
        let x = slot.x;
        let z = slot.z;

        // Everyone in their own half at kickoff; only the taker is on the ball.
        if (dir > 0) x = Math.min(x, -1.2);
        else x = Math.max(x, 1.2);

        // Non-kicking team must be outside the centre circle.
        if (t !== team && Math.hypot(x, z) < PITCH.centreCircleRadius + 0.5) {
          const l = Math.hypot(x, z) || 1;
          const s = (PITCH.centreCircleRadius + 1.2) / l;
          x *= s;
          z *= s;
          if (dir > 0) x = Math.min(x, -1.2);
          else x = Math.max(x, 1.2);
        }

        if (p.isKeeper) {
          x = -HALF_LENGTH * dir + dir * 1.4;
          z = 0;
        }

        p.resetForKickoff(x, z, dir > 0 ? Math.PI / 2 : -Math.PI / 2);
        p.freeze();
      }
    }

    // The kicking team's most advanced outfield player takes it.
    const taker = this.pickKickoffTaker(team);
    taker.pos.x = -TEAMS[team].attackDir * 0.9;
    taker.pos.z = 0.4;
    taker.heading = TEAMS[team].attackDir > 0 ? Math.PI / 2 : -Math.PI / 2;

    const support = world.teams[team].find((p) => p !== taker && !p.isKeeper && Math.abs(p.formationSlot.x) < 0.4);
    if (support) {
      support.pos.x = -TEAMS[team].attackDir * 2.2;
      support.pos.z = -3.4;
    }

    this.restart = {
      type: RestartType.KICKOFF,
      team,
      taker,
      spot: { x: 0, z: 0 },
      timer: MATCH.kickoffFreeze,
      taken: false,
      autoTakeAt: MATCH.kickoffFreeze + 3.2,
      elapsed: 0,
    };
    this.phase = Phase.KICKOFF;
    this.phaseTime = 0;
    this.bus.emit(EV.KICKOFF, { team });
    this.bus.emit(EV.WHISTLE, { kind: 'kickoff' });
  }

  pickKickoffTaker(team) {
    const dir = TEAMS[team].attackDir;
    let best = null;
    let bestX = -Infinity;
    for (const p of this.world.teams[team]) {
      if (p.isKeeper) continue;
      const adv = p.formationSlot.x;
      if (adv > bestX) {
        bestX = adv;
        best = p;
      }
    }
    return best || this.world.teams[team][1];
  }

  // ------------------------------------------------------------------ tick --

  /** Advance the simulation by a fixed step. */
  step(dt) {
    if (this.paused || this.phase === Phase.FULL_TIME) return;

    this.phaseTime += dt;

    // The clock runs through restarts and celebrations, exactly as it does in a
    // real match. Stopping it on every dead ball meant a "5 minute" match took
    // an unbounded amount of simulated time to reach full time.
    this.clock += dt * MATCH.clockScale;

    switch (this.phase) {
      case Phase.KICKOFF:
      case Phase.RESTART:
        this.stepRestart(dt);
        // A match can legitimately end while the ball is dead.
        if (this.clock >= this.duration && this.phase !== Phase.FULL_TIME) this.endMatch();
        break;
      case Phase.GOAL:
        this.stepGoal(dt);
        break;
      case Phase.PLAY:
      default:
        this.stepPlay(dt);
        break;
    }
  }

  stepPlay(dt) {
    this.runControllers(dt);
    this.world.step(dt);
    this.trackPossession(dt);

    const outcome = this.checkBallEvents();
    if (!outcome && this.clock >= this.duration) {
      this.endMatch();
    }
  }

  runControllers(dt) {
    const human = this.humanController;
    const controlled = human ? human.controlledPlayer : null;

    if (human) human.update(dt, this);

    for (let t = 0; t < 2; t++) {
      this.teamAI[t].update(dt, t === this.humanTeam ? controlled : null);
      // The human can control the keeper too; skip AI in that case.
      if (!(controlled && controlled.isKeeper && controlled.team === t)) {
        this.keeperAI[t].update(dt);
      }
    }
  }

  trackPossession(dt) {
    const owner = this.world.ball.owner;
    if (owner) {
      this.possessionTeam = owner.team;
      this.possessionTimer[owner.team] += dt;
    } else if (this.possessionTeam !== null) {
      // Loose ball still counts toward whoever touched it last, briefly.
      const lt = this.world.ball.lastToucherTeam;
      if (lt !== null && lt !== undefined) this.possessionTimer[lt] += dt * 0.5;
    }
    const total = this.possessionTimer[0] + this.possessionTimer[1] || 1;
    this.stats[0].possession = this.possessionTimer[0] / total;
    this.stats[1].possession = this.possessionTimer[1] / total;
  }

  stepGoal(dt) {
    // Celebration: players keep moving but the ball is dead.
    this.world.ball.frozen = true;
    for (const p of this.world.players) p.step(dt);
    if (this.phaseTime >= MATCH.celebrationTime) {
      for (const p of this.world.players) {
        if (p.state === PlayerState.CELEBRATE) p.setState(PlayerState.IDLE);
      }
      if (this.clock >= this.duration) {
        this.endMatch();
      } else {
        this.setupKickoff(this.lastGoal ? 1 - this.lastGoal.team : 0);
      }
    }
  }

  /**
   * Restart handling. The ball sits dead on the spot until the taker plays it —
   * either by human input or automatically after a short delay, so the match
   * can never stall.
   */
  stepRestart(dt) {
    const r = this.restart;
    if (!r) {
      this.phase = Phase.PLAY;
      return;
    }
    r.elapsed += dt;
    r.timer -= dt;

    const ball = this.world.ball;
    ball.frozen = true;
    ball.pos.x = r.spot.x;
    ball.pos.z = r.spot.z;
    ball.pos.y = r.type === RestartType.THROW_IN ? 1.75 : BALL.radius;
    ball.vel.x = 0;
    ball.vel.y = 0;
    ball.vel.z = 0;

    // Walk the taker onto the ball; everyone else takes up position.
    const taker = r.taker;
    const dir = TEAMS[r.team].attackDir;
    const approach = this.takerApproachPoint(r);

    for (const p of this.world.players) {
      if (p.state === PlayerState.FROZEN && r.type !== RestartType.KICKOFF) p.setState(PlayerState.IDLE);
    }

    if (r.type === RestartType.KICKOFF) {
      // Kickoff keeps everyone still until the whistle.
      if (r.timer > 0) {
        for (const p of this.world.players) p.freeze();
        return;
      }
      for (const p of this.world.players) {
        if (p.state === PlayerState.FROZEN) p.setState(PlayerState.IDLE);
      }
    }

    // Position the taker.
    const dTaker = dist2(taker.pos, approach);
    if (dTaker > 0.35) {
      taker.move((approach.x - taker.pos.x) / dTaker, (approach.z - taker.pos.z) / dTaker, clamp(dTaker / 2, 0.35, 1), dTaker > 6);
    } else {
      taker.stop();
      taker.heading = Math.atan2(r.spot.x - taker.pos.x || dir, r.spot.z - taker.pos.z || 0);
    }
    taker.step(dt);

    // Everyone else keeps shape and respects the clearance radius.
    const human = this.humanController;
    const controlled = human && r.type !== RestartType.KICKOFF ? human.controlledPlayer : null;
    if (human) human.update(dt, this);

    for (let t = 0; t < 2; t++) {
      this.teamAI[t].update(dt, taker.team === t ? taker : t === this.humanTeam ? controlled : null);
      if (!(controlled && controlled.isKeeper && controlled.team === t) && this.keeperAI[t].keeper !== taker) {
        this.keeperAI[t].update(dt);
      }
    }

    for (const p of this.world.players) {
      if (p === taker) continue;
      // Opponents must stand off; team-mates simply may not stand *on* the ball,
      // or the restart is knocked straight back out of play by its own side.
      const required = p.team !== r.team ? MATCH.restartClearance : MATCH.restartMateClearance;
      const d = dist2(p.pos, r.spot);
      if (d < required) {
        // Push outward, defaulting to "into the pitch" if exactly on the spot.
        let ux = d > 0.01 ? (p.pos.x - r.spot.x) / d : 0;
        let uz = d > 0.01 ? (p.pos.z - r.spot.z) / d : -Math.sign(r.spot.z || 1);
        if (p.team === r.team && r.type === RestartType.THROW_IN) {
          // Keep team-mates on the pitch side of a throw-in rather than in touch.
          uz = -Math.sign(r.spot.z || 1) * Math.max(Math.abs(uz), 0.55);
          const l = Math.hypot(ux, uz) || 1;
          ux /= l;
          uz /= l;
        }
        p.pos.x = r.spot.x + ux * required;
        p.pos.z = r.spot.z + uz * required;
      }
      p.step(dt);
    }

    this.world.resolvePlayerSeparation();
    this.world.constrainPlayers();

    // Human takes it themselves via a pass/shoot input, otherwise auto-take.
    const ready = dTaker < 1.3 && r.elapsed > MATCH.restartDelay * 0.5;
    if (ready && r.pendingTake) {
      this.executeRestart(r, r.pendingTake);
      return;
    }
    if (r.elapsed >= r.autoTakeAt && ready) {
      this.executeRestart(r, null);
      return;
    }
    // Safety valve: if the taker somehow can't reach the ball, force it.
    if (r.elapsed > r.autoTakeAt + 3.5) {
      taker.pos.x = approach.x;
      taker.pos.z = approach.z;
      this.executeRestart(r, null);
    }
  }

  takerApproachPoint(r) {
    const dir = TEAMS[r.team].attackDir;
    switch (r.type) {
      case RestartType.THROW_IN:
        return { x: r.spot.x, z: r.spot.z + Math.sign(r.spot.z) * 0.85 };
      case RestartType.CORNER:
        return {
          x: r.spot.x - Math.sign(r.spot.x) * 0.8,
          z: r.spot.z - Math.sign(r.spot.z) * 0.8,
        };
      case RestartType.GOAL_KICK:
        return { x: r.spot.x - dir * 1.0, z: r.spot.z };
      case RestartType.KICKOFF:
      default:
        return { x: -dir * 0.9, z: 0.35 };
    }
  }

  /** Signal from the human controller that they want to take the restart now. */
  requestRestartTake(kind, aim, power) {
    const r = this.restart;
    if (!r) return false;
    if (r.team !== this.humanTeam) return false;
    r.pendingTake = { kind, aim, power };
    return true;
  }

  executeRestart(r, request) {
    const ball = this.world.ball;
    const taker = r.taker;
    const dir = TEAMS[r.team].attackDir;
    const opps = this.world.teams[1 - r.team];
    const mates = this.world.teams[r.team];

    ball.frozen = false;
    ball.pos.x = r.spot.x;
    ball.pos.z = r.spot.z;
    ball.pos.y = r.type === RestartType.THROW_IN ? 1.55 : BALL.radius;
    ball.owner = null;
    ball.lastToucher = taker;
    ball.lastToucherTeam = taker.team;

    let type;
    let target;
    let power;

    if (request) {
      type = request.kind;
      power = request.power ?? 0.6;
      target = request.aim;
    } else {
      // Pick a sensible automatic delivery.
      const picked = this.autoRestartTarget(r, mates, opps);
      type = picked.type;
      target = picked.target;
      power = picked.power;
    }

    const aimX = target.x - ball.pos.x;
    const aimZ = target.z - ball.pos.z;
    const { vel, spin } = buildKick(taker, ball, type, clamp(power, 0, 1), aimX, aimZ, target, 0, this.rng);

    taker.heading = Math.atan2(vel.x, vel.z);
    taker.facing = taker.heading;
    taker.triggerKickAnim(r.type === RestartType.THROW_IN ? 'throw' : type);
    taker.possessionLock = PLAYER.possessionLockout * 2.2;
    ball.launch(taker, vel, spin, type, target);

    this.stats[r.team].passes++;
    this.restart = null;
    this.phase = Phase.PLAY;
    this.phaseTime = 0;

    for (const p of this.world.players) {
      if (p.state === PlayerState.FROZEN) p.setState(PlayerState.IDLE);
    }

    this.bus.emit(EV.RESTART_TAKEN, { type: r.type, team: r.team, taker, target });
    this.bus.emit(EV.KICK, { player: taker, type, power, pos: { ...ball.pos } });
  }

  autoRestartTarget(r, mates, opps) {
    const dir = TEAMS[r.team].attackDir;
    const spot = r.spot;

    if (r.type === RestartType.CORNER) {
      // Deliver into the box.
      const goalX = HALF_LENGTH * dir;
      return {
        type: 'loft',
        target: { x: goalX - dir * 6.5, z: this.rng.spread(HALF_GOAL * 1.1) },
        power: 0.85,
      };
    }

    if (r.type === RestartType.GOAL_KICK) {
      // Prefer a safe short option, else launch it.
      let best = null;
      for (const m of mates) {
        if (m === r.taker) continue;
        const d = dist2(spot, m.pos);
        if (d < 8 || d > 34) continue;
        const lane = laneSafety(spot, m.pos, opps, 1.8);
        const progress = ((m.pos.x - spot.x) * dir) / 34;
        const score = lane * 2 + progress;
        if (lane > 0.5 && (!best || score > best.score)) best = { m, score, d };
      }
      if (best && best.d < 24) {
        return { type: 'pass', target: { x: best.m.pos.x, z: best.m.pos.z }, power: clamp(best.d / 26, 0.4, 1) };
      }
      return {
        type: 'clear',
        target: { x: spot.x + dir * 42, z: clamp(this.rng.spread(HALF_WIDTH * 0.6), -HALF_WIDTH * 0.7, HALF_WIDTH * 0.7) },
        power: 1,
      };
    }

    // Throw-in / kickoff: find the best short option.
    let best = null;
    for (const m of mates) {
      if (m === r.taker) continue;
      const d = dist2(spot, m.pos);
      const maxD = r.type === RestartType.KICKOFF ? 18 : 20;
      if (d < 3 || d > maxD) continue;
      const lane = laneSafety(spot, m.pos, opps, 1.6);
      const progress = ((m.pos.x - spot.x) * dir) / maxD;
      const score = lane * 2.2 + progress * 0.8;
      if (lane > 0.35 && (!best || score > best.score)) best = { m, score, d };
    }

    if (best) {
      return {
        type: r.type === RestartType.THROW_IN ? 'pass' : 'pass',
        target: { x: best.m.pos.x + best.m.vel.x * 0.25, z: best.m.pos.z + best.m.vel.z * 0.25 },
        power: clamp(best.d / 20, 0.35, 0.9),
      };
    }

    return {
      type: 'pass',
      target: { x: spot.x + dir * 10, z: spot.z * 0.4 },
      power: 0.6,
    };
  }

  // ----------------------------------------------------------------- rules --

  /** Goal / out-of-play detection. Returns true if the ball is now dead. */
  checkBallEvents() {
    const ball = this.world.ball;

    // Goals first — a ball crossing the line between the posts is never "out".
    for (const side of [1, -1]) {
      if (ball.goalCheck(side)) {
        // The goal at +x belongs to the team defending +x; the scorer attacks it.
        const scoringTeam = TEAMS.findIndex((t) => t.attackDir === side);
        this.registerGoal(scoringTeam);
        return true;
      }
    }

    const out = ball.outOfPlay();
    if (!out) return false;

    const lastTeam = ball.lastToucherTeam ?? (this.possessionTeam ?? 0);

    if (out.type === 'touchline') {
      const team = 1 - lastTeam;
      const spot = {
        x: clamp(ball.pos.x, -HALF_LENGTH + 1, HALF_LENGTH - 1),
        z: Math.sign(out.side || 1) * HALF_WIDTH,
      };
      this.beginRestart(RestartType.THROW_IN, team, spot);
      this.bus.emit(EV.OUT_OF_PLAY, { kind: 'throwIn', team, spot });
      return true;
    }

    // Byline. The team defending this end is the one attacking the other way.
    const side = Math.sign(out.side || 1);
    const defendingTeam = TEAMS.findIndex((t) => t.attackDir === -side);
    const attackingTeam = 1 - defendingTeam;

    if (lastTeam === defendingTeam) {
      // Defender put it out → corner to the attackers.
      const spot = {
        x: side * (HALF_LENGTH - 0.25),
        z: Math.sign(ball.pos.z || 1) * (HALF_WIDTH - 0.25),
      };
      this.stats[attackingTeam].corners++;
      this.beginRestart(RestartType.CORNER, attackingTeam, spot);
      this.bus.emit(EV.OUT_OF_PLAY, { kind: 'corner', team: attackingTeam, spot });
    } else {
      const dir = TEAMS[defendingTeam].attackDir;
      const spot = {
        x: -dir * (HALF_LENGTH - PITCH.goalAreaDepth),
        z: Math.sign(ball.pos.z || 1) * (PITCH.goalAreaWidth / 2) * 0.55,
      };
      this.beginRestart(RestartType.GOAL_KICK, defendingTeam, spot);
      this.bus.emit(EV.OUT_OF_PLAY, { kind: 'goalKick', team: defendingTeam, spot });
    }
    return true;
  }

  beginRestart(type, team, spot) {
    const ball = this.world.ball;
    ball.frozen = true;
    ball.vel.x = 0;
    ball.vel.y = 0;
    ball.vel.z = 0;
    ball.owner = null;
    ball.inFlightFrom = null;
    for (const p of this.world.players) p.hasBall = false;

    const taker = this.pickTaker(type, team, spot);

    this.restart = {
      type,
      team,
      taker,
      spot,
      timer: MATCH.restartDelay,
      taken: false,
      pendingTake: null,
      autoTakeAt: MATCH.restartDelay + (team === this.humanTeam ? 3.4 : 1.4),
      elapsed: 0,
    };
    this.phase = Phase.RESTART;
    this.phaseTime = 0;
    this.bus.emit(EV.RESTART, { type, team, spot });
    this.bus.emit(EV.WHISTLE, { kind: type });
  }

  pickTaker(type, team, spot) {
    const players = this.world.teams[team];
    if (type === RestartType.GOAL_KICK) return players[0]; // keeper

    let best = null;
    let bestD = Infinity;
    for (const p of players) {
      if (p.isKeeper) continue;
      // Prefer wide players for corners and throws on their side.
      let d = dist2(p.pos, spot);
      if (type === RestartType.CORNER && Math.sign(p.pos.z) !== Math.sign(spot.z)) d += 6;
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best || players[1];
  }

  registerGoal(team) {
    this.score[team]++;
    this.stats[team].onTarget++;
    const scorer = this.world.ball.lastToucher;
    this.lastGoal = { team, scorer, time: this.clock };

    const ball = this.world.ball;
    ball.frozen = true;

    for (const p of this.world.players) {
      if (p.team === team && !p.isKeeper) {
        p.setState(PlayerState.CELEBRATE);
      } else {
        p.stop();
      }
    }

    this.phase = Phase.GOAL;
    this.phaseTime = 0;
    this.bus.emit(EV.GOAL, { team, scorer, score: [...this.score], time: this.clock });
    this.bus.emit(EV.WHISTLE, { kind: 'goal' });
  }

  endMatch() {
    this.phase = Phase.FULL_TIME;
    this.phaseTime = 0;
    this.clock = this.duration;
    this.world.ball.frozen = true;
    for (const p of this.world.players) p.stop();
    this.bus.emit(EV.FULL_TIME, { score: [...this.score], stats: this.stats });
    this.bus.emit(EV.WHISTLE, { kind: 'fullTime' });
  }

  togglePause() {
    if (this.phase === Phase.FULL_TIME) return this.paused;
    this.paused = !this.paused;
    this.bus.emit(EV.STATE, { paused: this.paused });
    return this.paused;
  }
}
