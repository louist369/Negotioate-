/**
 * Match auditor.
 *
 * Runs full matches — optionally with the human control path driven by a
 * scripted bot — and reports anomalies that a screenshot would never reveal:
 * stuck players, a stuck ball, impossible velocities, players out of the world,
 * animation state that never advances, and possession/tempo statistics.
 *
 *   node tools/audit.js [matches] [--bot] [--verbose]
 */
import { Match, Phase } from '../src/match/match.js';
import { PlayerController } from '../src/control/playerController.js';
import { PlayerState } from '../src/sim/player.js';
import { Rng } from '../src/core/rng.js';
import { EV } from '../src/core/events.js';
import { ScriptedInput, BotPlayer } from './botPlayer.js';
import {
  SIM,
  MATCH,
  PLAYER,
  BALL,
  HALF_LENGTH,
  HALF_WIDTH,
  PITCH,
} from '../src/core/config.js';

const matches = Number(process.argv[2]) || 4;
const useBot = process.argv.includes('--bot');
const verbose = process.argv.includes('--verbose');
const STEP = SIM.fixedStep;

function auditMatch(seed) {
  const match = new Match({ seed, humanTeam: 0 });
  const rng = new Rng(seed ^ 0x5f3759df);

  let bot = null;
  let input = null;
  if (useBot) {
    input = new ScriptedInput();
    const controller = new PlayerController({
      input,
      teamId: 0,
      world: match.world,
      bus: match.bus,
    });
    match.attachHumanController(controller);
    bot = new BotPlayer({ match, controller, input, rng });
  }

  const issues = [];
  const note = (kind, detail) => {
    issues.push({ kind, detail });
  };

  // --- anomaly trackers ---------------------------------------------------
  const stillFor = new Map(); // player -> seconds without moving
  const lastPos = new Map();
  let ballStillFor = 0;
  let ballStillWorst = 0;
  let maxPlayerSpeed = 0;
  let maxBallSpeed = 0;
  let animFrozen = new Map();

  let ownedTicks = 0;
  let looseTicks = 0;
  let deadTicks = 0;
  let total = 0;

  const counts = { goals: [0, 0], shots: [0, 0], saves: 0, restarts: 0, tackles: 0 };
  match.bus.on(EV.GOAL, (e) => counts.goals[e.team]++);
  match.bus.on(EV.SHOT, (e) => counts.shots[e.player.team]++);
  match.bus.on(EV.SAVE, (e) => {
    if (!e.attempt) counts.saves++;
  });
  match.bus.on(EV.RESTART_TAKEN, () => counts.restarts++);
  match.bus.on(EV.TACKLE_WON, () => counts.tackles++);

  const maxSteps = Math.ceil((MATCH.durationSeconds + 90) / STEP);
  let steps = 0;
  const t0 = Date.now();

  while (!match.isOver && steps < maxSteps) {
    if (bot) bot.update(STEP);
    match.step(STEP);
    if (input) input.endFrame();
    steps++;
    total++;

    const b = match.world.ball;

    // Ball sanity.
    const bs = b.speed;
    maxBallSpeed = Math.max(maxBallSpeed, bs);
    if (!Number.isFinite(b.pos.x + b.pos.y + b.pos.z)) {
      note('ball-nan', `step ${steps}`);
      break;
    }
    if (b.pos.y < -0.01) note('ball-below-ground', `y=${b.pos.y.toFixed(3)} step ${steps}`);
    if (Math.abs(b.pos.x) > HALF_LENGTH + PITCH.margin + 5) {
      note('ball-escaped', `x=${b.pos.x.toFixed(1)} step ${steps}`);
    }

    if (match.phase === Phase.PLAY) {
      if (b.owner) ownedTicks++;
      else looseTicks++;
      // A live ball that nobody moves for a long time means the AI has lost it.
      if (bs < 0.2 && !b.owner) {
        ballStillFor += STEP;
        ballStillWorst = Math.max(ballStillWorst, ballStillFor);
      } else {
        ballStillFor = 0;
      }
    } else {
      deadTicks++;
      ballStillFor = 0;
    }

    // Player sanity — sampled, since this is the expensive part.
    if (steps % 12 === 0) {
      for (const p of match.world.players) {
        if (!Number.isFinite(p.pos.x + p.pos.z)) {
          note('player-nan', `#${p.number} step ${steps}`);
          continue;
        }
        const sp = p.speed;
        maxPlayerSpeed = Math.max(maxPlayerSpeed, sp);
        if (sp > PLAYER.sprintSpeed * 1.45 && p.state !== PlayerState.TACKLE && p.state !== PlayerState.DIVE) {
          note('player-overspeed', `#${p.number} ${sp.toFixed(1)}m/s state=${p.state}`);
        }
        if (Math.abs(p.pos.x) > HALF_LENGTH + PITCH.margin || Math.abs(p.pos.z) > HALF_WIDTH + PITCH.margin) {
          note('player-out-of-world', `#${p.number} (${p.pos.x.toFixed(1)},${p.pos.z.toFixed(1)})`);
        }

        // Stuck detection: in open play, an outfield player who has not moved
        // at all for a long stretch is a behaviour bug.
        const key = p.id;
        const prev = lastPos.get(key);
        const moved = prev ? Math.hypot(p.pos.x - prev.x, p.pos.z - prev.z) : 1;
        lastPos.set(key, { x: p.pos.x, z: p.pos.z });
        if (match.phase === Phase.PLAY && !p.isKeeper) {
          const t = (stillFor.get(key) || 0) + (moved < 0.02 ? STEP * 12 : -999);
          stillFor.set(key, Math.max(0, t));
          if (t > 6) {
            note('player-stuck', `#${p.number} team${p.team} still ${t.toFixed(1)}s at (${p.pos.x.toFixed(1)},${p.pos.z.toFixed(1)})`);
            stillFor.set(key, 0);
          }
        }

        // Animation liveness: a moving player whose stride cycle is frozen.
        if (sp > 1.5) {
          const a = animFrozen.get(key);
          if (a !== undefined && Math.abs(a - p.anim.cycle) < 1e-9) {
            note('anim-frozen', `#${p.number} cycle stuck while moving at ${sp.toFixed(1)}m/s`);
          }
          animFrozen.set(key, p.anim.cycle);
        }
      }
    }
  }

  const wall = Date.now() - t0;

  return {
    seed,
    finished: match.isOver,
    score: [...match.score],
    counts,
    bot: bot ? { ...bot.stats } : null,
    possession: [match.stats[0].possession, match.stats[1].possession],
    control: ownedTicks / Math.max(ownedTicks + looseTicks, 1),
    deadShare: deadTicks / Math.max(total, 1),
    ballStillWorst,
    maxPlayerSpeed,
    maxBallSpeed,
    issues,
    wall,
  };
}

const all = [];
for (let i = 0; i < matches; i++) {
  const r = auditMatch(4200 + i * 733);
  all.push(r);
  const botStr = r.bot
    ? `  bot(sh ${r.bot.shots} pa ${r.bot.passes} tk ${r.bot.tackles} sw ${r.bot.switches})`
    : '';
  console.log(
    `match ${i + 1} seed=${r.seed} ${r.score[0]}-${r.score[1]} ` +
      `control ${(r.control * 100).toFixed(0)}% dead ${(r.deadShare * 100).toFixed(0)}% ` +
      `stillMax ${r.ballStillWorst.toFixed(1)}s issues ${r.issues.length}${botStr} ` +
      `${r.finished ? 'FT' : 'UNFINISHED'}`
  );
}

// Aggregate issues by kind.
const byKind = new Map();
for (const r of all) {
  for (const it of r.issues) {
    const list = byKind.get(it.kind) || [];
    list.push(it.detail);
    byKind.set(it.kind, list);
  }
}

console.log('\n--- anomalies ---');
if (byKind.size === 0) {
  console.log('  none');
} else {
  for (const [kind, list] of [...byKind.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${String(list.length).padStart(4)}  ${kind}`);
    if (verbose) for (const d of list.slice(0, 5)) console.log(`         ${d}`);
  }
}

const avg = (f) => all.reduce((a, r) => a + f(r), 0) / all.length;
console.log('\n--- aggregate ---');
console.log('all finished       ', all.every((r) => r.finished));
console.log('close control      ', (avg((r) => r.control) * 100).toFixed(1) + '% of open play');
console.log('dead-ball share    ', (avg((r) => r.deadShare) * 100).toFixed(1) + '%');
console.log('worst ball-idle    ', Math.max(...all.map((r) => r.ballStillWorst)).toFixed(1) + 's');
console.log('max player speed   ', Math.max(...all.map((r) => r.maxPlayerSpeed)).toFixed(1) + ' m/s');
console.log('max ball speed     ', Math.max(...all.map((r) => r.maxBallSpeed)).toFixed(1) + ' m/s');
console.log('goals              ', avg((r) => r.counts.goals[0]).toFixed(2) + ' - ' + avg((r) => r.counts.goals[1]).toFixed(2));
console.log('shots              ', avg((r) => r.counts.shots[0]).toFixed(2) + ' - ' + avg((r) => r.counts.shots[1]).toFixed(2));
console.log('saves/match        ', avg((r) => r.counts.saves).toFixed(2));

if (useBot) {
  const t0 = avg((r) => r.counts.goals[0]);
  const t1 = avg((r) => r.counts.goals[1]);
  console.log(
    `\nHUMAN-PATH RESULT: bot-controlled team 0 scored ${t0.toFixed(2)}, conceded ${t1.toFixed(2)} per match`
  );
}
