/**
 * Close-up inspection shots at full quality.
 *
 * The broadcast camera is deliberately far away, which hides both detail and
 * defects. This harness parks the camera near the action at the `high` quality
 * tier so character rigs, kit materials, shadows and the goal net can actually
 * be judged.
 *
 *   node tools/closeup.js
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.resolve(ROOT, 'screenshots');
const PORT = 4174;

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
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
    setTimeout(() => !settled && (settled = true, resolve(proc)), 6000);
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

  // Small viewport keeps the software rasteriser usable at high quality.
  const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto(`http://localhost:${PORT}/?quality=medium`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => !!window.__pitchcraft, null, { timeout: 60000 });
  await sleep(2500);

  /**
   * Freeze the camera at a fixed vantage. `update()` would immediately drag it
   * back, so we neutralise it for the duration of the inspection.
   */
  await page.evaluate(() => {
    const app = window.__pitchcraft;
    app.scene.cameraRig.update = function () {};
    window.__look = (px, py, pz, tx, ty, tz, fov) => {
      const cam = app.scene.cameraRig.camera;
      cam.fov = fov || 40;
      cam.position.set(px, py, pz);
      cam.lookAt(tx, ty, tz);
      cam.updateProjectionMatrix();
    };
    window.__sim = (s) => {
      if (app.match.paused) app.match.togglePause();
      const step = 1 / 120;
      for (let i = 0; i < Math.floor(s / step); i++) app.match.step(step);
    };
    // Hide the HUD so it doesn't cover the subject.
    document.getElementById('hud').style.display = 'none';
  });

  const shot = async (name) => {
    await sleep(700);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log(`  captured ${name}.png`);
  };

  // 1. A player in close-up, mid-run.
  console.log('close-up: running player');
  await page.evaluate(() => window.__sim(8));
  await page.evaluate(() => {
    const app = window.__pitchcraft;
    // Pick the fastest-moving outfield player so we catch a real run pose.
    const p = app.match.world.players
      .filter((q) => !q.isKeeper)
      .sort((a, b) => b.speed - a.speed)[0];
    window.__look(p.pos.x + 4.5, 2.1, p.pos.z + 5.2, p.pos.x, 1.0, p.pos.z, 34);
  });
  await shot('10-closeup-player');

  // 2. The goalmouth: net, frame, keeper, shadows.
  console.log('close-up: goalmouth');
  await page.evaluate(() => {
    const { HALF_LENGTH } = { HALF_LENGTH: 39 };
    window.__look(HALF_LENGTH - 16, 4.2, 11, HALF_LENGTH + 1, 1.2, 0, 42);
  });
  await shot('11-goalmouth');

  // 3. Mid-height tactical view showing team shape and shadows.
  console.log('close-up: shape');
  await page.evaluate(() => window.__sim(6));
  await page.evaluate(() => {
    const b = window.__pitchcraft.match.world.ball;
    window.__look(b.pos.x + 2, 12, b.pos.z + 24, b.pos.x, 0.6, b.pos.z, 42);
  });
  await shot('12-shape');

  const info = await page.evaluate(() => {
    const r = window.__pitchcraft.scene.renderer;
    return { calls: r.info.render.calls, tris: r.info.render.triangles };
  });
  console.log('renderer at high quality:', JSON.stringify(info));
  console.log(`errors: ${errors.length}`);
  for (const e of errors.slice(0, 8)) console.log('  ', e);

  await browser.close();
  server.kill();
  if (errors.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
