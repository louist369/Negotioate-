/**
 * Browser interaction audit.
 *
 * Exercises the paths that only exist in a real browser and that the headless
 * suites cannot reach: camera mode switching, the pause/resume overlay, the
 * difficulty picker, the WebAudio graph, restart-and-play-again, and the human
 * taking their own set piece. Every step asserts observable state rather than
 * just "it didn't throw".
 *
 *   node tools/interact.js
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 4178;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer() {
  return new Promise((resolve) => {
    const proc = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let settled = false;
    const onData = (d) => {
      if (!settled && /localhost:\d+/.test(d.toString())) {
        settled = true;
        resolve(proc);
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    setTimeout(() => !settled && ((settled = true), resolve(proc)), 6000);
  });
}

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

async function main() {
  const server = await startServer();
  await sleep(1200);

  const preinstalled = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  const browser = await chromium.launch({
    headless: true,
    executablePath: existsSync(preinstalled) ? preinstalled : undefined,
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--no-sandbox',
      // Let WebAudio start without a real output device.
      '--autoplay-policy=no-user-gesture-required',
    ],
  });

  const page = await browser.newPage({ viewport: { width: 1024, height: 576 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto(`http://localhost:${PORT}/?quality=low`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => !!window.__pitchcraft, null, { timeout: 60000 });
  await sleep(1500);

  // --- camera ------------------------------------------------------------
  console.log('camera:');
  const camBefore = await page.evaluate(() => {
    const c = window.__pitchcraft.scene.cameraRig;
    return { mode: c.mode, fov: c.camera.fov, y: c.camera.position.y };
  });
  await page.keyboard.press('KeyC');
  await sleep(900);
  const camAfter = await page.evaluate(() => {
    const c = window.__pitchcraft.scene.cameraRig;
    return { mode: c.mode, fov: c.camera.fov, y: c.camera.position.y };
  });
  check('camera mode toggles', camAfter.mode !== camBefore.mode, `${camBefore.mode} -> ${camAfter.mode}`);
  check(
    'close camera is lower and wider',
    camAfter.y < camBefore.y && camAfter.fov > camBefore.fov,
    `y ${camBefore.y.toFixed(1)}->${camAfter.y.toFixed(1)}, fov ${camBefore.fov.toFixed(0)}->${camAfter.fov.toFixed(0)}`
  );
  await page.keyboard.press('KeyC');
  await sleep(700);
  const camBack = await page.evaluate(() => window.__pitchcraft.scene.cameraRig.mode);
  check('camera toggles back', camBack === camBefore.mode);

  // The camera must never end up under the pitch or inside a stand.
  const camSane = await page.evaluate(async () => {
    const app = window.__pitchcraft;
    let minY = Infinity;
    let maxY = -Infinity;
    // Kept modest: this harness renders on a software rasteriser.
    for (let i = 0; i < 60; i++) {
      for (let k = 0; k < 30; k++) app.match.step(1 / 120);
      app.scene.update(1 / 60, null);
      minY = Math.min(minY, app.scene.cameraRig.camera.position.y);
      maxY = Math.max(maxY, app.scene.cameraRig.camera.position.y);
    }
    return { minY, maxY };
  });
  check('camera stays above the pitch', camSane.minY > 2, `min y ${camSane.minY.toFixed(1)}`);
  check('camera stays below the roof', camSane.maxY < 26, `max y ${camSane.maxY.toFixed(1)}`);

  // --- audio -------------------------------------------------------------
  console.log('audio:');
  await page.evaluate(() => {
    window.__pitchcraft.audio.start();
    window.__pitchcraft.audio.resume();
  });
  await sleep(400);
  const audio = await page.evaluate(() => {
    const a = window.__pitchcraft.audio;
    if (!a.ctx) return { started: false };
    // Fire one of every voice; a throw here would surface as a page error.
    a.kick(0.8, 0.7);
    a.post();
    a.whistle(0.3, 2);
    a.tackle();
    a.bounce(0.5);
    a.roar();
    a.blip(600, 0.05, 0.05);
    return {
      started: a.started,
      state: a.ctx.state,
      sampleRate: a.ctx.sampleRate,
      hasCrowd: !!a.crowd && !!a.crowd.gain,
    };
  });
  check('audio context starts', audio.started === true, `state=${audio.state}`);
  check('crowd bed exists', audio.hasCrowd === true);
  await sleep(600);
  const muted = await page.evaluate(() => window.__pitchcraft.audio.toggleMute());
  check('mute toggles', muted === false);
  await page.evaluate(() => window.__pitchcraft.audio.toggleMute());

  // --- pause / resume -----------------------------------------------------
  console.log('pause:');
  await page.evaluate(() => window.__pitchcraft.pause());
  await sleep(400);
  const paused = await page.evaluate(() => ({
    paused: window.__pitchcraft.match.paused,
    overlay: !document.querySelector('[data-overlay]').hidden,
    clock: window.__pitchcraft.match.clock,
  }));
  check('pause halts the match', paused.paused === true);
  check('pause overlay is visible', paused.overlay === true);
  await sleep(700);
  const clockHeld = await page.evaluate(() => window.__pitchcraft.match.clock);
  check('clock frozen while paused', Math.abs(clockHeld - paused.clock) < 1e-6);

  // --- difficulty picker --------------------------------------------------
  console.log('difficulty:');
  const before = await page.evaluate(() => window.__pitchcraft.match.difficultyName);
  await page.click('[data-difficulty="easy"]');
  await sleep(500);
  const afterEasy = await page.evaluate(() => ({
    name: window.__pitchcraft.match.difficultyName,
    oppSpeed: window.__pitchcraft.match.world.teams[1][3].skill.speed,
    mateSpeed: window.__pitchcraft.match.world.teams[0][3].skill.speed,
    overlay: !document.querySelector('[data-overlay]').hidden,
    score: [...window.__pitchcraft.match.score],
  }));
  check('difficulty button changes level', afterEasy.name === 'easy', `${before} -> ${afterEasy.name}`);
  check('opponent is handicapped', afterEasy.oppSpeed < 1, `speed ${afterEasy.oppSpeed}`);
  check('own team-mates are not handicapped', afterEasy.mateSpeed === 1);
  check('changing difficulty starts a fresh match', afterEasy.score[0] === 0 && afterEasy.score[1] === 0);
  check('overlay closes after choosing', afterEasy.overlay === false);

  // --- human takes their own restart --------------------------------------
  console.log('human restart:');
  const restartResult = await page.evaluate(async () => {
    const app = window.__pitchcraft;
    const m = app.match;
    // Force a throw-in to the human's team.
    const b = m.world.ball;
    for (let i = 0; i < 600 && m.phase !== 'play'; i++) m.step(1 / 120);
    b.frozen = false;
    b.owner = null;
    b.pos.x = 0;
    b.pos.z = 24;
    b.vel.x = 0;
    b.vel.z = 14;
    b.lastToucher = m.world.teams[1][2];
    b.lastToucherTeam = 1; // opponent put it out -> human throw-in
    for (let i = 0; i < 300 && m.phase !== 'restart'; i++) m.step(1 / 120);
    if (m.phase !== 'restart') return { reached: false };

    const type = m.restart.type;
    const team = m.restart.team;
    // Let the taker walk to the ball.
    for (let i = 0; i < 300; i++) m.step(1 / 120);

    const taken = m.requestRestartTake('pass', { x: 0, z: 10 }, 0.6);
    let becamePlay = false;
    for (let i = 0; i < 600; i++) {
      m.step(1 / 120);
      if (m.phase === 'play') {
        becamePlay = true;
        break;
      }
    }
    return { reached: true, type, team, taken, becamePlay, humanTeam: m.humanTeam };
  });
  check('a throw-in is awarded to the human team', restartResult.reached && restartResult.team === restartResult.humanTeam, `type=${restartResult.type}`);
  check('human restart request is accepted', restartResult.taken === true);
  check('play resumes after the human takes it', restartResult.becamePlay === true);

  // --- play again ---------------------------------------------------------
  console.log('restart:');
  const replay = await page.evaluate(() => {
    const app = window.__pitchcraft;
    app.match.score[0] = 3;
    app.restart();
    return {
      score: [...app.match.score],
      clock: app.match.clock,
      phase: app.match.phase,
      controlled: !!app.controller.controlledPlayer,
    };
  });
  check('play again resets the score', replay.score[0] === 0 && replay.score[1] === 0);
  check('play again resets the clock', replay.clock === 0);
  check('play again returns to kickoff', replay.phase === 'kickoff');
  check('a player is still selected', replay.controlled === true);

  await sleep(600);
  console.log(`\nconsole errors: ${errors.length}`);
  for (const e of errors.slice(0, 8)) console.log('  ', e);

  await browser.close();
  server.kill();

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length || errors.length) {
    console.error('FAIL');
    process.exit(1);
  }
  console.log('OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
