/**
 * Resource-leak audit.
 *
 * "Restart without duplicated objects or state corruption" is verified at the
 * simulation level by the unit tests, but the renderer, HUD and audio layers all
 * subscribe to the event bus and build GPU resources — none of which the sim
 * tests can see. This restarts the real build many times and checks that scene
 * graph size, GPU allocations and event-bus subscriptions all stay flat.
 *
 *   node tools/leakcheck.js [restarts]
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 4177;
const RESTARTS = Number(process.argv[2]) || 12;
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

async function main() {
  const server = await startServer();
  await sleep(1200);

  const preinstalled = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  const browser = await chromium.launch({
    headless: true,
    executablePath: existsSync(preinstalled) ? preinstalled : undefined,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });

  const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto(`http://localhost:${PORT}/?quality=low`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => !!window.__pitchcraft, null, { timeout: 60000 });
  await sleep(2000);

  const snapshot = () =>
    page.evaluate(() => {
      const app = window.__pitchcraft;
      const r = app.scene.renderer;
      let objects = 0;
      app.scene.scene.traverse(() => objects++);
      // Total handlers registered across every event type on the bus.
      let handlers = 0;
      for (const list of app.bus.handlers.values()) handlers += list.length;
      return {
        objects,
        geometries: r.info.memory.geometries,
        textures: r.info.memory.textures,
        programs: r.info.programs ? r.info.programs.length : 0,
        players: app.scene.players.size,
        simPlayers: app.match.world.players.length,
        handlers,
        busQueue: app.bus.queue.length,
        score: [...app.match.score],
      };
    });

  const before = await snapshot();
  console.log('baseline:', JSON.stringify(before));

  const runRestarts = async (n) => {
    for (let i = 0; i < n; i++) {
      await page.evaluate(() => {
        const app = window.__pitchcraft;
        // Play a chunk of a match, including goals and restarts, then reset.
        const step = 1 / 120;
        for (let k = 0; k < 120 * 45; k++) app.match.step(step);
        app.restart();
      });
      await sleep(120);
    }
    await sleep(800);
    return snapshot();
  };

  // Two equal batches rather than one.
  //
  // Some resources are allocated lazily on first use — a render target that
  // only exists once a pass has run, a particle geometry that only uploads
  // once a goal has been celebrated. Those show up as a one-off delta against
  // the baseline and are not leaks, which is why this check used to carry a
  // hardcoded "one texture is allowed" allowance.
  //
  // Measuring the second batch instead removes the guesswork: whatever is
  // lazily initialised has already happened by the end of batch one, so a
  // genuine leak is exactly "batch two also grew". That is both stricter (no
  // allowance to hide behind) and more honest about what is being asserted.
  const mid = await runRestarts(RESTARTS);
  console.log('after %d restarts: %s', RESTARTS, JSON.stringify(mid));
  const after = await runRestarts(RESTARTS);
  console.log('after %d restarts: %s', RESTARTS * 2, JSON.stringify(after));

  const KEYS = ['objects', 'geometries', 'textures', 'programs', 'players', 'simPlayers', 'handlers'];
  const firstBatch = {};
  const secondBatch = {};
  for (const k of KEYS) {
    firstBatch[k] = mid[k] - before[k];
    secondBatch[k] = after[k] - mid[k];
  }
  console.log('first batch (lazy init + any leak): ', JSON.stringify(firstBatch));
  console.log('second batch (leak only):           ', JSON.stringify(secondBatch));

  const fails = [];
  for (const [k, v] of Object.entries(secondBatch)) {
    if (v > 0) fails.push(`${k} grew by ${v} in the second batch of ${RESTARTS} restarts`);
  }
  // Event recording is opt-in; a running match must not accumulate a log.
  if (after.busQueue > 64) fails.push(`bus event queue grew to ${after.busQueue}`);

  console.log(`\nconsole errors: ${errors.length}`);
  for (const e of errors.slice(0, 6)) console.log('  ', e);

  await browser.close();
  server.kill();

  if (fails.length || errors.length) {
    console.error('\nFAIL:');
    for (const f of fails) console.error('  ' + f);
    process.exit(1);
  }
  console.log('\nOK — no growth across the second batch of restarts');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
