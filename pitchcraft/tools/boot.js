/** Load the built game and print the first runtime error, if any. */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const PORT = 4191;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: ['ignore','pipe','pipe'] });
await new Promise((r) => setTimeout(r, 3500));
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text().slice(0, 600)); });
page.on('pageerror', (e) => console.log('PAGEERROR:', String(e.stack || e).slice(0, 900)));
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 40000 });
await new Promise((r) => setTimeout(r, 5000));
const ok = await page.evaluate(() => !!window.__pitchcraft);
console.log('booted:', ok);
await browser.close(); server.kill(); process.exit(0);
