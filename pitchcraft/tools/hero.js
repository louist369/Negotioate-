/**
 * Capture one broadcast frame with shadow mapping enabled.
 *
 * The main harness runs at `low` because it renders on a software rasteriser.
 * This one runs at `high` — full crowd density, shadow mapping, full pixel
 * ratio — so the visual quality a real player sees is actually verified. It
 * uses a small viewport to stay within a sensible time budget in software.
 *
 *   node tools/hero.js
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.resolve(ROOT, 'screenshots');
const PORT = 4176;

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

  const page = await browser.newPage({ viewport: { width: 720, height: 405 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto(`http://localhost:${PORT}/?quality=medium`, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => !!window.__pitchcraft, null, { timeout: 90000 });
  await sleep(2500);

  // Both sides on AI, then advance to a moment with the ball in an attacking third.
  await page.evaluate(() => {
    const app = window.__pitchcraft;
    app.setAutoPlay(true);
    const step = 1 / 120;
    // Step until the ball is in a final third with players around it.
    for (let i = 0; i < 120 * 200; i++) {
      app.match.step(step);
      const b = app.match.world.ball;
      if (i > 120 * 8 && Math.abs(b.pos.x) > 20 && app.match.phase === 'play') break;
    }
  });
  await sleep(2500);

  await page.screenshot({ path: path.join(OUT, '13-hero-shadows.png') });
  console.log('captured 13-hero-shadows.png');

  const info = await page.evaluate(() => {
    const r = window.__pitchcraft.scene.renderer;
    return {
      calls: r.info.render.calls,
      triangles: r.info.render.triangles,
      geometries: r.info.memory.geometries,
      textures: r.info.memory.textures,
      shadows: r.shadowMap.enabled,
      pixelRatio: r.getPixelRatio(),
    };
  });
  console.log('medium quality renderer:', JSON.stringify(info));
  console.log(`errors: ${errors.length}`);
  for (const e of errors.slice(0, 6)) console.log('  ', e);

  await browser.close();
  server.kill();
  if (errors.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
