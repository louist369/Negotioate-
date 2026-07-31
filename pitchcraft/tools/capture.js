/**
 * Browser test + screenshot harness.
 *
 * Loads the built game in Chromium, drives it with synthetic input, captures the
 * required evidence shots and reports any console errors or WebGL warnings.
 *
 *   node tools/capture.js [--headed] [--out screenshots]
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.resolve(ROOT, process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'screenshots');
const PORT = 4173;

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let settled = false;
    const onData = (d) => {
      const s = d.toString();
      if (!settled && /localhost:\d+/.test(s)) {
        settled = true;
        resolve(proc);
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', reject);
    setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(proc);
      }
    }, 6000);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const server = await startServer();
  await sleep(1200);

  // Use the Chromium already provisioned in this environment rather than
  // downloading another build.
  const preinstalled = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  const browser = await chromium.launch({
    headless: !process.argv.includes('--headed'),
    executablePath: existsSync(preinstalled) ? preinstalled : undefined,
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-gpu-sandbox',
      '--no-sandbox',
    ],
  });

  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });

  const errors = [];
  const warnings = [];
  page.on('console', (msg) => {
    const t = msg.type();
    if (t === 'error') errors.push(msg.text());
    else if (t === 'warning') warnings.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

  console.log('loading…');
  // The harness renders on a software rasteriser, so run the low quality tier.
  await page.goto(`http://localhost:${PORT}/?quality=low`, { waitUntil: 'load', timeout: 60000 });

  // Wait for the app to expose itself.
  await page.waitForFunction(() => !!window.__pitchcraft, null, { timeout: 45000 });
  await sleep(1500);

  const shot = async (name) => {
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log(`  captured ${name}.png`);
  };

  /**
   * Advance the match by simulating N seconds directly.
   *
   * The harness runs on a software rasteriser at a few frames per second, so
   * waiting in real time for match events would take many minutes. Stepping the
   * simulation explicitly keeps the run fast and, because the sim is
   * deterministic and frame-rate independent, produces exactly the same match
   * a player would see.
   */
  const fastForward = async (seconds) => {
    await page.evaluate((s) => {
      const app = window.__pitchcraft;
      // Never step while paused, or the loop silently does nothing.
      if (app.match.paused) app.match.togglePause();
      const step = 1 / 120;
      const n = Math.floor(s / step);
      for (let i = 0; i < n; i++) app.match.step(step);
    }, seconds);
    await sleep(260);
  };

  /**
   * Step the sim until `key` is flagged by an event listener, or the budget of
   * simulated seconds runs out. Stops on the exact frame the event fires so the
   * screenshot shows the moment itself.
   */
  const stepUntil = async (key, budgetSeconds) => {
    return await page.evaluate(
      ([k, budget]) => {
        const app = window.__pitchcraft;
        if (app.match.paused) app.match.togglePause();
        const step = 1 / 120;
        const n = Math.floor(budget / step);
        window.__evidence[k] = false;
        for (let i = 0; i < n; i++) {
          app.match.step(step);
          if (window.__evidence[k]) return true;
        }
        return false;
      },
      [key, budgetSeconds]
    );
  };

  /** Let a few frames render so animation and camera damping settle. */
  const play = async (seconds) => {
    await sleep(seconds * 1000);
  };

  const state = () =>
    page.evaluate(() => {
      const m = window.__pitchcraft.match;
      return {
        phase: m.phase,
        score: [...m.score],
        clock: Math.round(m.clock),
        ball: { x: +m.world.ball.pos.x.toFixed(1), z: +m.world.ball.pos.z.toFixed(1) },
      };
    });

  await page.evaluate(() => {
    window.__evidence = {};
    const m = window.__pitchcraft.match;
    const flag = (k) => () => (window.__evidence[k] = true);
    m.bus.on('shot', flag('shot'));
    m.bus.on('save', (e) => {
      if (!e.attempt) window.__evidence.save = true;
    });
    m.bus.on('goal', flag('goal'));
    m.bus.on('outOfPlay', flag('restart'));
    m.bus.on('pass', (e) => {
      if (e.type === 'pass') window.__evidence.pass = true;
    });
    m.bus.on('possession', (e) => {
      if (e.player) window.__evidence.receive = true;
    });
  });

  console.log('kickoff…');
  await play(0.8);
  await shot('01-kickoff');

  console.log('midfield play…');
  await fastForward(14);
  await play(0.7);
  await shot('02-midfield');

  // Drive the human player directly so the input path is genuinely exercised.
  console.log('driving human input…');
  await page.keyboard.down('KeyW');
  await page.keyboard.down('ShiftLeft');
  await play(1.4);
  await page.keyboard.up('ShiftLeft');
  await page.keyboard.up('KeyW');
  await page.keyboard.press('KeyJ');
  await play(0.5);

  const evidence = {};
  const capture = async (key, name, budget, settle = 0.5) => {
    const got = await stepUntil(key, budget);
    evidence[key] = got;
    if (got) {
      await play(settle);
      await shot(name);
    } else {
      console.log(`  (no ${key} within ${budget}s of simulation)`);
    }
    return got;
  };

  await capture('pass', '03-passing', 30, 0.35);
  await capture('shot', '04-shot', 90, 0.3);
  await capture('save', '05-save', 120, 0.35);
  await capture('restart', '06-restart', 60, 0.9);
  await capture('goal', '07-goal', 200, 1.1);

  console.log('pause screen…');
  await page.evaluate(() => window.__pitchcraft.pause());
  await play(0.7);
  await shot('08-pause');
  await page.evaluate(() => window.__pitchcraft.resume());
  await play(0.3);

  console.log('running to full time…');
  await fastForward(340);
  await play(1.0);
  await shot('09-fulltime');

  const final = await state();
  console.log('\nfinal state:', JSON.stringify(final));

  // Measure sustained frame rate over a real-time window.
  console.log('measuring frame rate…');
  await page.evaluate(() => window.__pitchcraft.restart());
  await sleep(600);
  const fps = await page.evaluate(async () => {
    return await new Promise((resolve) => {
      let frames = 0;
      const t0 = performance.now();
      const tick = () => {
        frames++;
        if (performance.now() - t0 < 4000) requestAnimationFrame(tick);
        else resolve((frames * 1000) / (performance.now() - t0));
      };
      requestAnimationFrame(tick);
    });
  });

  const info = await page.evaluate(() => {
    const r = window.__pitchcraft.scene.renderer;
    return {
      calls: r.info.render.calls,
      triangles: r.info.render.triangles,
      geometries: r.info.memory.geometries,
      textures: r.info.memory.textures,
      programs: r.info.programs ? r.info.programs.length : 0,
    };
  });

  console.log(`\nrendered ${fps.toFixed(1)} fps (software rasteriser — see notes)`);
  console.log('renderer:', JSON.stringify(info));

  console.log(`\nconsole errors: ${errors.length}`);
  for (const e of errors.slice(0, 12)) console.log('  ERROR', e);
  const relevantWarnings = warnings.filter((w) => !/vite|sourcemap/i.test(w));
  console.log(`console warnings: ${relevantWarnings.length}`);
  for (const w of relevantWarnings.slice(0, 8)) console.log('  WARN', w);

  await browser.close();
  server.kill();

  if (errors.length) {
    console.error('\nFAIL: console errors present');
    process.exit(1);
  }
  console.log('\nOK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
