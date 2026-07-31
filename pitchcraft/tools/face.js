/**
 * Face and kit inspection.
 *
 * Parks the camera directly in front of a player's head at eye level, and then
 * behind him for the kit. The existing close-up harness shoots from three
 * quarters behind, which is exactly the angle that cannot tell you whether a
 * face is right.
 *
 *   node tools/face.js
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const OUT = 'screenshots/face';
const PORT = 4187;
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
await sleep(3500);

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 700, height: 700 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://localhost:${PORT}/?quality=high`, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => !!window.__pitchcraft, null, { timeout: 150000 });
await sleep(3000);

await page.evaluate(() => {
  const app = window.__pitchcraft;
  app.scene.cameraRig.update = function () {};
  document.getElementById('hud').style.display = 'none';
  // Freeze a player upright and facing +Z so the camera can be placed exactly.
  const p = app.match.world.players.find((q) => !q.isKeeper);
  window.__subject = p;
  app.match.togglePause();
  p.pos.x = 0;
  p.pos.z = 0;
  p.heading = 0;
  p.facing = 0;
  app.scene.update(0.016, null);
  window.__look = (px, py, pz, tx, ty, tz, fov) => {
    const cam = app.scene.cameraRig.camera;
    cam.fov = fov || 22;
    cam.position.set(px, py, pz);
    cam.lookAt(tx, ty, tz);
    cam.updateProjectionMatrix();
  };
});

const eye = 1.72;
const shot = async (name, pos, target, fov) => {
  await page.evaluate(
    ([p, t, f]) => window.__look(p[0], p[1], p[2], t[0], t[1], t[2], f),
    [pos, target, fov]
  );
  await sleep(900);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`  ${name}.png`);
};

// The player faces +Z, so the camera goes to +Z to see his face.
await shot('01-face-front', [0, eye, 1.15], [0, eye - 0.04, 0], 20);
await shot('02-face-three-quarter', [0.75, eye, 0.95], [0, eye - 0.04, 0], 20);
await shot('03-face-profile', [1.2, eye, 0.05], [0, eye - 0.04, 0], 20);
await shot('04-kit-back', [0, 1.15, -2.4], [0, 1.05, 0], 34);
await shot('05-kit-front', [0, 1.15, 2.4], [0, 1.05, 0], 34);
await shot('06-full-body', [1.6, 1.1, 2.6], [0, 0.95, 0], 40);

console.log('console errors:', errors.length);
for (const e of errors.slice(0, 5)) console.log('  ', e);
await browser.close();
server.kill();
process.exit(0);
