/** Difficulty separation over a large sample. node tools/diffcheck.js [n] */
import { Match } from '../src/match/match.js';
import { SIM, MATCH } from '../src/core/config.js';
const n = Number(process.argv[2]) || 12;
for (const level of ['easy', 'normal', 'hard']) {
  let gf = 0, ga = 0, shots = [0, 0];
  for (let i = 0; i < n; i++) {
    const m = new Match({ seed: 700 + i * 97, humanTeam: 0, difficulty: level });
    const max = Math.ceil((MATCH.durationSeconds + 60) / SIM.fixedStep);
    for (let s = 0; s < max && !m.isOver; s++) m.step(SIM.fixedStep);
    gf += m.score[0]; ga += m.score[1];
    shots[0] += m.stats[0].shots; shots[1] += m.stats[1].shots;
  }
  console.log(`${level.padEnd(7)} human ${(gf / n).toFixed(2)} - ${(ga / n).toFixed(2)} opp   margin ${((gf - ga) / n).toFixed(2)}   shots ${(shots[0] / n).toFixed(1)}/${(shots[1] / n).toFixed(1)}`);
}
