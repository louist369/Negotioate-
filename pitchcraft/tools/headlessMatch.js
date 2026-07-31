/**
 * Headless match runner. Simulates full AI-vs-AI matches with no renderer and
 * reports aggregate behaviour — the fastest way to catch balance and stall bugs.
 *
 *   node tools/headlessMatch.js [matches] [--verbose]
 */
import { Match } from '../src/match/match.js';
import { EV } from '../src/core/events.js';
import { SIM, MATCH } from '../src/core/config.js';

const matches = Number(process.argv[2]) || 5;
const verbose = process.argv.includes('--verbose');

function runMatch(seed) {
  const match = new Match({ seed, humanTeam: 0, difficulty: 'hard' });
  const counts = {
    goals: 0,
    shots: 0,
    saves: 0,
    catches: 0,
    posts: 0,
    throwIns: 0,
    corners: 0,
    goalKicks: 0,
    tackles: 0,
    intercepts: 0,
    passes: 0,
  };
  const timeline = [];

  match.bus.on(EV.GOAL, (e) => {
    counts.goals++;
    timeline.push({ t: e.time, kind: 'goal', team: e.team });
  });
  match.bus.on(EV.SHOT, () => counts.shots++);
  match.bus.on(EV.SAVE, (e) => {
    if (!e.attempt) counts.saves++;
  });
  match.bus.on(EV.CATCH, () => counts.catches++);
  match.bus.on(EV.POST, () => counts.posts++);
  match.bus.on(EV.PASS, () => counts.passes++);
  match.bus.on(EV.TACKLE_WON, () => counts.tackles++);
  match.bus.on(EV.INTERCEPT, () => counts.intercepts++);
  match.bus.on(EV.OUT_OF_PLAY, (e) => {
    if (e.kind === 'throwIn') counts.throwIns++;
    else if (e.kind === 'corner') counts.corners++;
    else counts.goalKicks++;
  });

  const dt = SIM.fixedStep;
  const maxSteps = Math.ceil((MATCH.durationSeconds + 180) / dt);
  let steps = 0;
  let lastPhaseChange = 0;
  let lastPhase = match.phase;
  let maxPhaseStall = 0;
  let ballOutOfBounds = 0;

  const t0 = Date.now();
  while (!match.isOver && steps < maxSteps) {
    match.step(dt);
    steps++;

    if (match.phase !== lastPhase) {
      maxPhaseStall = Math.max(maxPhaseStall, (steps - lastPhaseChange) * dt);
      lastPhase = match.phase;
      lastPhaseChange = steps;
    }

    const b = match.world.ball;
    if (!Number.isFinite(b.pos.x) || !Number.isFinite(b.pos.z) || !Number.isFinite(b.pos.y)) {
      throw new Error(`Ball position went non-finite at step ${steps}`);
    }
    if (Math.abs(b.pos.x) > 120 || Math.abs(b.pos.z) > 120) ballOutOfBounds++;

    for (const p of match.world.players) {
      if (!Number.isFinite(p.pos.x) || !Number.isFinite(p.pos.z)) {
        throw new Error(`Player ${p.id} position went non-finite at step ${steps}`);
      }
    }
  }
  const wall = Date.now() - t0;

  return {
    seed,
    score: [...match.score],
    counts,
    finished: match.isOver,
    steps,
    simSeconds: steps * dt,
    wallMs: wall,
    realtimeFactor: (steps * dt * 1000) / Math.max(wall, 1),
    possession: [match.stats[0].possession, match.stats[1].possession],
    maxPhaseStall,
    ballOutOfBounds,
    timeline,
  };
}

const results = [];
for (let i = 0; i < matches; i++) {
  const r = runMatch(1000 + i * 977);
  results.push(r);
  console.log(
    `match ${i + 1}  seed=${r.seed}  ${r.score[0]}-${r.score[1]}  ` +
      `shots ${r.counts.shots}  saves ${r.counts.saves}  posts ${r.counts.posts}  ` +
      `corners ${r.counts.corners}  throws ${r.counts.throwIns}  gk ${r.counts.goalKicks}  ` +
      `tackles ${r.counts.tackles}  poss ${(r.possession[0] * 100).toFixed(0)}/${(r.possession[1] * 100).toFixed(0)}  ` +
      `${r.finished ? 'FT' : 'UNFINISHED'}  ${(r.realtimeFactor).toFixed(0)}x realtime`
  );
  if (verbose) {
    for (const ev of r.timeline) {
      console.log(`   ${Math.floor(ev.t / 60)}:${String(Math.floor(ev.t % 60)).padStart(2, '0')} GOAL team ${ev.team}`);
    }
  }
}

const sum = (f) => results.reduce((a, r) => a + f(r), 0);
const n = results.length;
console.log('\n--- aggregate over %d matches ---', n);
console.log('goals/match      %s', (sum((r) => r.counts.goals) / n).toFixed(2));
console.log('shots/match      %s', (sum((r) => r.counts.shots) / n).toFixed(2));
console.log('saves/match      %s', (sum((r) => r.counts.saves) / n).toFixed(2));
console.log('corners/match    %s', (sum((r) => r.counts.corners) / n).toFixed(2));
console.log('throw-ins/match  %s', (sum((r) => r.counts.throwIns) / n).toFixed(2));
console.log('goal kicks/match %s', (sum((r) => r.counts.goalKicks) / n).toFixed(2));
console.log('tackles won/match %s', (sum((r) => r.counts.tackles) / n).toFixed(2));
console.log('passes/match     %s', (sum((r) => r.counts.passes) / n).toFixed(2));
console.log('longest stall    %ss', (Math.max(...results.map((r) => r.maxPhaseStall))).toFixed(1));
console.log('all finished     %s', results.every((r) => r.finished));
console.log('sim speed        %sx realtime', (sum((r) => r.realtimeFactor) / n).toFixed(0));

if (!results.every((r) => r.finished)) {
  console.error('\nFAIL: at least one match did not reach full time');
  process.exit(1);
}
