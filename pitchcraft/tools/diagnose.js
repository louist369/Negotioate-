/**
 * Diagnostic harness: attributes every dead-ball event to the action that caused
 * it, so tuning decisions are driven by data rather than guesswork.
 *
 *   node tools/diagnose.js [matches]
 */
import { Match } from '../src/match/match.js';
import { EV } from '../src/core/events.js';
import { SIM, MATCH } from '../src/core/config.js';

const matches = Number(process.argv[2]) || 6;

const causes = new Map();
const shotOutcomes = new Map();
const bump = (map, k) => map.set(k, (map.get(k) || 0) + 1);

let totalPassAttempts = 0;
let totalPassCompleted = 0;
let tackleAttempts = 0;
let tackleWins = 0;
let possessionChanges = 0;
let shotDistances = [];
let goalDistances = [];

for (let i = 0; i < matches; i++) {
  const match = new Match({ seed: 5000 + i * 613, humanTeam: 0 });
  const ball = match.world.ball;

  let lastIntent = null;
  let pendingPass = null;
  let lastShot = null;

  match.bus.on(EV.PASS, (e) => {
    totalPassAttempts++;
    pendingPass = { team: e.player.team, type: e.type };
  });
  match.bus.on(EV.SHOT, (e) => {
    lastShot = { team: e.player.team, dist: Math.hypot(e.pos.x - (e.target?.x ?? 0), e.pos.z - (e.target?.z ?? 0)) };
    shotDistances.push(lastShot.dist);
  });
  match.bus.on(EV.POSSESSION, (e) => {
    if (e.player) {
      possessionChanges++;
      if (pendingPass && e.player.team === pendingPass.team) totalPassCompleted++;
      pendingPass = null;
    }
  });
  match.bus.on(EV.TACKLE, (e) => {
    if (e.attempt) tackleAttempts++;
  });
  match.bus.on(EV.TACKLE_WON, () => tackleWins++);
  match.bus.on(EV.GOAL, () => {
    if (lastShot) goalDistances.push(lastShot.dist);
    bump(shotOutcomes, 'goal');
    lastShot = null;
  });
  match.bus.on(EV.SAVE, (e) => {
    if (!e.attempt) bump(shotOutcomes, e.caught ? 'caught' : 'parried');
  });
  match.bus.on(EV.POST, (e) => bump(shotOutcomes, e.kind));

  match.bus.on(EV.OUT_OF_PLAY, (e) => {
    const intent = ball.intent || 'dribble/loose';
    bump(causes, `${e.kind} <- ${intent}`);
  });

  const dt = SIM.fixedStep;
  const maxSteps = Math.ceil((MATCH.durationSeconds + 120) / dt);
  let steps = 0;
  while (!match.isOver && steps < maxSteps) {
    match.step(dt);
    steps++;
  }
}

const sorted = [...causes.entries()].sort((a, b) => b[1] - a[1]);
console.log(`--- dead-ball causes over ${matches} matches (per match) ---`);
for (const [k, v] of sorted) console.log(`  ${(v / matches).toFixed(2).padStart(6)}  ${k}`);

console.log(`\n--- shot outcomes (per match) ---`);
for (const [k, v] of [...shotOutcomes.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${(v / matches).toFixed(2).padStart(6)}  ${k}`);
}

const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
console.log(`\npass attempts/match  ${(totalPassAttempts / matches).toFixed(1)}`);
console.log(`pass completion      ${((totalPassCompleted / Math.max(totalPassAttempts, 1)) * 100).toFixed(0)}%`);
console.log(`tackle attempts/match ${(tackleAttempts / matches).toFixed(1)}`);
console.log(`tackle wins/match     ${(tackleWins / matches).toFixed(1)}`);
console.log(`possession changes/match ${(possessionChanges / matches).toFixed(1)}`);
console.log(`avg shot distance    ${avg(shotDistances).toFixed(1)}m`);
console.log(`avg goal distance    ${avg(goalDistances).toFixed(1)}m`);
