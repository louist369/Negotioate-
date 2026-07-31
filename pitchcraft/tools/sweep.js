/**
 * Parameter sweep over a large match sample. Balance decisions at 2 goals a
 * match need more than a handful of seeds — 14-match samples were producing
 * non-monotone difficulty curves purely from noise.
 *
 *   node tools/sweep.js KEEPER.baseSave 1.02,1.08,1.14 [matches]
 */
import { Match } from '../src/match/match.js';
import * as CONFIG from '../src/core/config.js';
import { SIM, MATCH } from '../src/core/config.js';

const [pathArg, valuesArg] = process.argv.slice(2);
const n = Number(process.argv[4]) || 24;

function runSample(level, count, seed0) {
  let gf = 0, ga = 0, shots = 0, saves = 0, finished = 0;
  for (let i = 0; i < count; i++) {
    const m = new Match({ seed: seed0 + i * 97, humanTeam: 0, difficulty: level });
    const max = Math.ceil((MATCH.durationSeconds + 60) / SIM.fixedStep);
    for (let s = 0; s < max && !m.isOver; s++) m.step(SIM.fixedStep);
    if (m.isOver) finished++;
    gf += m.score[0]; ga += m.score[1];
    shots += m.stats[0].shots + m.stats[1].shots;
    saves += m.stats[0].saves + m.stats[1].saves;
  }
  const goals = (gf + ga) / count;
  return {
    margin: (gf - ga) / count, goals, shots: shots / count,
    saves: saves / count, conv: goals / Math.max(shots / count, 0.01), finished,
  };
}

const fmt = (r) => `goals ${r.goals.toFixed(2)}  shots ${r.shots.toFixed(2)}  conv ${(r.conv * 100).toFixed(0)}%  saves ${r.saves.toFixed(2)}  margin ${r.margin.toFixed(2)}`;

if (!pathArg) {
  for (const level of ['easy', 'normal', 'hard']) {
    console.log(`${level.padEnd(7)} ${fmt(runSample(level, n, 700))}`);
  }
} else {
  const [group, key] = pathArg.split('.');
  const target = CONFIG[group];
  if (!target || !(key in target)) throw new Error(`unknown parameter ${pathArg}`);
  const original = target[key];
  for (const raw of valuesArg.split(',')) {
    target[key] = Number(raw);
    const overall = runSample('hard', n, 700);
    console.log(`${pathArg}=${raw.padStart(6)}  ${fmt(overall)}`);
  }
  target[key] = original;
}
