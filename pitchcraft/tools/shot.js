/**
 * Fast look. Two screenshots — a broadcast frame and a close-up — in about 25
 * seconds, so a lighting or material change can be judged without waiting for
 * the full capture run.
 *
 *   node tools/shot.js [outdir] [simSeconds]
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2] || 'screenshots/look';
const WARM = Number(process.argv[3]) || 20;
const PORT = 4193;
mkdirSync(OUT, { recursive: true });

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
await new Promise((r) => setTimeout(r, 3500));

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__pitchcraft?.scene, null, { timeout: 30000 });

// Fast-forward the simulation without waiting for real frames, then snap the
// camera: stepping the sim directly leaves the follow camera 2400 frames
// behind the ball, which is how the first version of this tool produced shots
// looking down an empty pitch.
await page.evaluate((secs) => {
  const m = window.__pitchcraft.match;
  const step = window.tune.SIM.fixedStep;
  for (let i = 0; i < secs / step; i++) {
    m.step(step);
    // Stop on a live ball so shots are never framed on a dead-ball restart.
    if (i > (secs / step) * 0.8 && m.phase === 'play') break;
  }
  window.__pitchcraft.scene.cameraRig.snapTo(m.world.ball);
}, WARM);
await new Promise((r) => setTimeout(r, 3000));

await page.screenshot({ path: path.join(OUT, 'broadcast.png') });

await page.keyboard.press('c');
await page.evaluate(() => {
  const p = window.__pitchcraft;
  p.scene.cameraRig.snapTo(p.match.world.ball);
});
await new Promise((r) => setTimeout(r, 3000));
await page.screenshot({ path: path.join(OUT, 'close.png') });

console.log(`wrote ${OUT}/broadcast.png and ${OUT}/close.png`);
console.log('console errors:', errors.length);
for (const e of errors.slice(0, 6)) console.log('  ', e);

await browser.close();
server.kill();
process.exit(0);
