/**
 * Evaluate an expression inside the running game and print the result. The
 * fastest way to answer "is this actually configured the way I think it is?"
 * without a full capture run.
 *
 *   node tools/probe.js "__pitchcraft.scene.renderer.shadowMap.enabled"
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 4183;
const expr = process.argv[2] || '1';

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
await new Promise((r) => setTimeout(r, 3500));

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('console', (m) => { if (m.type() === 'error') console.log('ERR', m.text()); });
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__pitchcraft?.scene, null, { timeout: 30000 });
await new Promise((r) => setTimeout(r, 2500));

const out = await page.evaluate((e) => {
  try { return JSON.stringify(eval(e), null, 1); } catch (err) { return 'THREW: ' + err.message; }
}, expr);
console.log(out);

await browser.close();
server.kill();
process.exit(0);
