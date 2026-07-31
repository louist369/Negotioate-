import { describe, it, expect, beforeEach } from 'vitest';
import { Match, Phase, RestartType } from '../src/match/match.js';
import { EV } from '../src/core/events.js';
import {
  MATCH,
  SIM,
  PITCH,
  TEAMS,
  HALF_LENGTH,
  HALF_WIDTH,
  HALF_GOAL,
  BALL,
} from '../src/core/config.js';

const STEP = SIM.fixedStep;

/** Advance the match by `seconds`, optionally stopping early. */
function run(match, seconds, until = null) {
  const n = Math.ceil(seconds / STEP);
  for (let i = 0; i < n; i++) {
    match.step(STEP);
    if (until && until(match)) return true;
  }
  return false;
}

/** Put the ball somewhere with a velocity, bypassing possession. */
function placeBall(match, x, z, vx = 0, vz = 0, y = BALL.radius, vy = 0) {
  const b = match.world.ball;
  b.frozen = false;
  b.owner = null;
  b.pos.x = x;
  b.pos.z = z;
  b.pos.y = y;
  b.vel.x = vx;
  b.vel.y = vy;
  b.vel.z = vz;
}

/** Force the match out of its kickoff freeze into open play. */
function forceLive(match) {
  run(match, 8, (m) => m.phase === Phase.PLAY);
  expect(match.phase).toBe(Phase.PLAY);
}

/**
 * Move every player far off the pitch so a scripted ball trajectory is not
 * intercepted by a keeper or a chasing defender. These tests are about the
 * rules, not about beating the AI.
 */
function clearPlayers(match) {
  for (const p of match.world.players) {
    p.pos.x = -300;
    p.pos.z = -300 + p.id * 3;
    p.vel.x = 0;
    p.vel.z = 0;
    p.hasBall = false;
  }
  match.world.ball.owner = null;
}

describe('pitch and team orientation', () => {
  it('gives each team an opposing attacking direction', () => {
    expect(TEAMS[0].attackDir).toBe(-TEAMS[1].attackDir);
  });

  it('places each keeper in front of the goal its team defends', () => {
    const match = new Match({ seed: 1 });
    for (let t = 0; t < 2; t++) {
      const gk = match.world.keeperOf(t);
      const ownGoalX = -HALF_LENGTH * TEAMS[t].attackDir;
      // The keeper must be much nearer its own goal than the opposition's.
      expect(Math.abs(gk.pos.x - ownGoalX)).toBeLessThan(HALF_LENGTH);
      expect(Math.sign(gk.pos.x)).toBe(Math.sign(ownGoalX));
    }
  });

  it('starts every player inside the field of play', () => {
    const match = new Match({ seed: 2 });
    for (const p of match.world.players) {
      expect(Math.abs(p.pos.x)).toBeLessThanOrEqual(HALF_LENGTH + 0.001);
      expect(Math.abs(p.pos.z)).toBeLessThanOrEqual(HALF_WIDTH + 0.001);
    }
  });
});

describe('goals', () => {
  it.each([
    [0, 1],
    [1, -1],
  ])('awards a goal to team %i when the ball crosses the goal at x = %i * half length', (team, side) => {
    const match = new Match({ seed: 3 });
    forceLive(match);
    clearPlayers(match);

    const goals = [];
    match.bus.on(EV.GOAL, (e) => goals.push(e));

    // The goal at `side` belongs to the team defending it; `team` attacks it.
    expect(TEAMS[team].attackDir).toBe(side);

    placeBall(match, side * (HALF_LENGTH - 2), 0, side * 25, 0);
    run(match, 2, (m) => goals.length > 0);

    expect(goals.length).toBe(1);
    expect(goals[0].team).toBe(team);
    expect(match.score[team]).toBe(1);
    expect(match.score[1 - team]).toBe(0);
  });

  it('does not award a goal for a ball that misses the frame', () => {
    const match = new Match({ seed: 4 });
    forceLive(match);
    clearPlayers(match);
    const goals = [];
    match.bus.on(EV.GOAL, (e) => goals.push(e));

    // Wide of the post.
    placeBall(match, HALF_LENGTH - 2, HALF_GOAL + 2.5, 25, 0);
    run(match, 2);
    expect(goals.length).toBe(0);
  });

  it('does not award a goal for a ball over the crossbar', () => {
    const match = new Match({ seed: 5 });
    forceLive(match);
    clearPlayers(match);
    const goals = [];
    match.bus.on(EV.GOAL, (e) => goals.push(e));

    placeBall(match, HALF_LENGTH - 3, 0, 22, 0, PITCH.goalHeight + 1.4, 4);
    run(match, 2);
    expect(goals.length).toBe(0);
  });

  it('restarts with a kickoff to the conceding team after a goal', () => {
    const match = new Match({ seed: 6 });
    forceLive(match);
    clearPlayers(match);

    placeBall(match, HALF_LENGTH - 2, 0, 25, 0);
    run(match, 2, (m) => m.phase === Phase.GOAL);
    expect(match.phase).toBe(Phase.GOAL);

    // Scoring team is 0 (attacks +x); team 1 restarts.
    run(match, MATCH.celebrationTime + 1, (m) => m.phase === Phase.KICKOFF);
    expect(match.phase).toBe(Phase.KICKOFF);
    expect(match.restart.type).toBe(RestartType.KICKOFF);
    expect(match.restart.team).toBe(1);
    // Ball is back on the centre spot.
    expect(Math.abs(match.world.ball.pos.x)).toBeLessThan(0.01);
    expect(Math.abs(match.world.ball.pos.z)).toBeLessThan(0.01);
  });
});

describe('ball out of play', () => {
  it('awards a throw-in to the team that did not touch it last', () => {
    const match = new Match({ seed: 7 });
    forceLive(match);
    clearPlayers(match);

    const events = [];
    match.bus.on(EV.OUT_OF_PLAY, (e) => events.push(e));

    const toucher = match.world.teams[0][3];
    placeBall(match, 0, HALF_WIDTH - 1, 0, 14);
    match.world.ball.lastToucher = toucher;
    match.world.ball.lastToucherTeam = 0;

    run(match, 2, () => events.length > 0);
    expect(events.length).toBe(1);
    expect(events[0].kind).toBe('throwIn');
    expect(events[0].team).toBe(1);
    // Spot is on the touchline at the point of exit.
    expect(Math.abs(events[0].spot.z)).toBeCloseTo(HALF_WIDTH, 5);
  });

  it('awards a corner when a defender puts it behind their own goal line', () => {
    const match = new Match({ seed: 8 });
    forceLive(match);
    clearPlayers(match);
    const events = [];
    match.bus.on(EV.OUT_OF_PLAY, (e) => events.push(e));

    // Goal at +x is defended by team 1 (attackDir -1). Team 1 touches it out.
    const defender = match.world.teams[1][1];
    placeBall(match, HALF_LENGTH - 1, HALF_GOAL + 4, 16, 0);
    match.world.ball.lastToucher = defender;
    match.world.ball.lastToucherTeam = 1;

    run(match, 2, () => events.length > 0);
    expect(events.length).toBe(1);
    expect(events[0].kind).toBe('corner');
    expect(events[0].team).toBe(0);
    expect(match.stats[0].corners).toBe(1);
    expect(Math.abs(events[0].spot.x)).toBeCloseTo(HALF_LENGTH - 0.25, 5);
    expect(Math.abs(events[0].spot.z)).toBeCloseTo(HALF_WIDTH - 0.25, 5);
  });

  it('awards a goal kick when an attacker puts it behind the goal line', () => {
    const match = new Match({ seed: 9 });
    forceLive(match);
    clearPlayers(match);
    const events = [];
    match.bus.on(EV.OUT_OF_PLAY, (e) => events.push(e));

    // Team 0 attacks +x; if team 0 puts it out there it's a goal kick to team 1.
    const attacker = match.world.teams[0][5];
    placeBall(match, HALF_LENGTH - 1, HALF_GOAL + 4, 16, 0);
    match.world.ball.lastToucher = attacker;
    match.world.ball.lastToucherTeam = 0;

    run(match, 2, () => events.length > 0);
    expect(events.length).toBe(1);
    expect(events[0].kind).toBe('goalKick');
    expect(events[0].team).toBe(1);
  });

  it('has the keeper take a goal kick', () => {
    const match = new Match({ seed: 10 });
    forceLive(match);
    clearPlayers(match);
    placeBall(match, HALF_LENGTH - 1, HALF_GOAL + 4, 16, 0);
    match.world.ball.lastToucherTeam = 0;
    match.world.ball.lastToucher = match.world.teams[0][5];

    run(match, 2, (m) => m.phase === Phase.RESTART);
    expect(match.restart.type).toBe(RestartType.GOAL_KICK);
    expect(match.restart.taker.isKeeper).toBe(true);
    expect(match.restart.taker.team).toBe(1);
  });
});

describe('restarts always resume play', () => {
  it.each([
    ['throwIn', () => ({ x: 0, z: HALF_WIDTH - 1, vx: 0, vz: 14 })],
    ['corner/goalKick', () => ({ x: HALF_LENGTH - 1, z: HALF_GOAL + 5, vx: 16, vz: 0 })],
  ])('returns to open play after a %s', (_label, setup) => {
    const match = new Match({ seed: 11 });
    forceLive(match);
    const s = setup();
    placeBall(match, s.x, s.z, s.vx, s.vz);

    const gotRestart = run(match, 3, (m) => m.phase === Phase.RESTART);
    expect(gotRestart).toBe(true);

    // Auto-take must always fire, so the match can never stall on a dead ball.
    const resumed = run(match, 14, (m) => m.phase === Phase.PLAY);
    expect(resumed).toBe(true);
    expect(match.world.ball.frozen).toBe(false);
  });

  it('keeps opponents outside the clearance radius at a restart', () => {
    const match = new Match({ seed: 12 });
    forceLive(match);
    placeBall(match, 0, HALF_WIDTH - 1, 0, 14);
    run(match, 3, (m) => m.phase === Phase.RESTART);
    expect(match.phase).toBe(Phase.RESTART);

    // Let the restart settle, then check spacing.
    run(match, 0.9);
    const r = match.restart;
    if (!r) return; // already taken — nothing to assert
    for (const p of match.world.players) {
      if (p.team === r.team) continue;
      const d = Math.hypot(p.pos.x - r.spot.x, p.pos.z - r.spot.z);
      expect(d).toBeGreaterThanOrEqual(MATCH.restartClearance - 0.5);
    }
  });

  it('does not leave a team-mate standing on the ball at a throw-in', () => {
    const match = new Match({ seed: 13 });
    forceLive(match);
    placeBall(match, 0, HALF_WIDTH - 1, 0, 14);
    run(match, 3, (m) => m.phase === Phase.RESTART);
    run(match, 0.9);
    const r = match.restart;
    if (!r) return;
    for (const p of match.world.players) {
      if (p === r.taker) continue;
      const d = Math.hypot(p.pos.x - r.spot.x, p.pos.z - r.spot.z);
      expect(d).toBeGreaterThanOrEqual(MATCH.restartMateClearance - 0.5);
    }
  });
});

describe('match clock and full time', () => {
  it('counts down from the configured duration', () => {
    const match = new Match({ seed: 14 });
    expect(match.timeRemaining).toBeCloseTo(MATCH.durationSeconds, 3);
    forceLive(match);
    run(match, 10);
    expect(match.clock).toBeGreaterThan(5);
    expect(match.timeRemaining).toBeLessThan(MATCH.durationSeconds);
  });

  it('does not advance the clock while paused', () => {
    const match = new Match({ seed: 15 });
    forceLive(match);
    run(match, 2);
    const t = match.clock;
    match.togglePause();
    run(match, 3);
    expect(match.clock).toBeCloseTo(t, 5);
    match.togglePause();
    run(match, 1);
    expect(match.clock).toBeGreaterThan(t);
  });

  it('ends at full time and stops simulating', () => {
    const match = new Match({ seed: 16 });
    const ft = [];
    match.bus.on(EV.FULL_TIME, (e) => ft.push(e));

    run(match, MATCH.durationSeconds + 30, (m) => m.isOver);

    expect(match.isOver).toBe(true);
    expect(match.phase).toBe(Phase.FULL_TIME);
    expect(ft.length).toBe(1);
    expect(match.clock).toBeCloseTo(MATCH.durationSeconds, 3);

    const before = match.clock;
    run(match, 5);
    expect(match.clock).toBeCloseTo(before, 6);
  });
});

describe('reset and repeat playability', () => {
  it('restores a clean state without duplicating entities', () => {
    const match = new Match({ seed: 17 });
    const playerCount = match.world.players.length;
    const ids = match.world.players.map((p) => p.id);

    forceLive(match);
    run(match, 40);
    match.score[0] = 3;
    match.score[1] = 2;

    match.resetMatch(99);

    expect(match.world.players.length).toBe(playerCount);
    expect(match.world.players.map((p) => p.id)).toEqual(ids);
    expect(match.score).toEqual([0, 0]);
    expect(match.clock).toBe(0);
    expect(match.phase).toBe(Phase.KICKOFF);
    expect(match.paused).toBe(false);
    expect(match.world.ball.owner).toBeNull();
    for (const p of match.world.players) {
      expect(p.hasBall).toBe(false);
      expect(Number.isFinite(p.pos.x)).toBe(true);
    }
  });

  it('can play two full matches back to back', () => {
    const match = new Match({ seed: 18 });
    run(match, MATCH.durationSeconds + 40, (m) => m.isOver);
    expect(match.isOver).toBe(true);

    match.resetMatch(19);
    expect(match.isOver).toBe(false);
    run(match, MATCH.durationSeconds + 40, (m) => m.isOver);
    expect(match.isOver).toBe(true);
  });
});

describe('AI keeps the game in a valid state', () => {
  it('keeps every player and the ball finite and on the world for a full match', () => {
    const match = new Match({ seed: 20 });
    const lim = HALF_LENGTH + PITCH.margin + 2;
    const limz = HALF_WIDTH + PITCH.margin + 2;

    const n = Math.ceil((MATCH.durationSeconds + 30) / STEP);
    for (let i = 0; i < n && !match.isOver; i++) {
      match.step(STEP);
      if (i % 47 !== 0) continue; // sampling is enough and keeps the test fast
      const b = match.world.ball;
      expect(Number.isFinite(b.pos.x + b.pos.y + b.pos.z)).toBe(true);
      for (const p of match.world.players) {
        expect(Number.isFinite(p.pos.x + p.pos.z)).toBe(true);
        expect(Math.abs(p.pos.x)).toBeLessThanOrEqual(lim);
        expect(Math.abs(p.pos.z)).toBeLessThanOrEqual(limz);
      }
    }
    expect(match.isOver).toBe(true);
  });

  it('never lets two players occupy the same point', () => {
    const match = new Match({ seed: 21 });
    forceLive(match);
    for (let i = 0; i < 4000; i++) {
      match.step(STEP);
      if (i % 200) continue;
      const ps = match.world.players;
      for (let a = 0; a < ps.length; a++) {
        for (let b = a + 1; b < ps.length; b++) {
          const d = Math.hypot(ps[a].pos.x - ps[b].pos.x, ps[a].pos.z - ps[b].pos.z);
          expect(d).toBeGreaterThan(0.2);
        }
      }
    }
  });
});

describe('determinism', () => {
  it('produces an identical match from the same seed', () => {
    const a = new Match({ seed: 4242 });
    const b = new Match({ seed: 4242 });
    for (let i = 0; i < 9000; i++) {
      a.step(STEP);
      b.step(STEP);
    }
    expect(a.score).toEqual(b.score);
    expect(a.clock).toBeCloseTo(b.clock, 9);
    expect(a.world.ball.pos.x).toBeCloseTo(b.world.ball.pos.x, 9);
    expect(a.world.ball.pos.z).toBeCloseTo(b.world.ball.pos.z, 9);
    for (let i = 0; i < a.world.players.length; i++) {
      expect(a.world.players[i].pos.x).toBeCloseTo(b.world.players[i].pos.x, 9);
    }
  });

  it('produces different matches from different seeds', () => {
    const a = new Match({ seed: 1 });
    const b = new Match({ seed: 2 });
    for (let i = 0; i < 9000; i++) {
      a.step(STEP);
      b.step(STEP);
    }
    const same =
      Math.abs(a.world.ball.pos.x - b.world.ball.pos.x) < 1e-6 &&
      Math.abs(a.world.ball.pos.z - b.world.ball.pos.z) < 1e-6;
    expect(same).toBe(false);
  });
});
