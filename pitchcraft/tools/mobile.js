/**
 * Mobile / touch audit.
 *
 * Emulates an iPhone in landscape — real touch events, device pixel ratio,
 * mobile user agent — and drives the on-screen controls the way a thumb would.
 * Asserts that the stick actually moves the player, that each action button
 * reaches the simulation, and that nothing lands under the notch or off screen.
 *
 *   node tools/mobile.js [--shot]
 */
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.resolve(ROOT, 'screenshots');
const PORT = 4182;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

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
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });

  // iPhone 13 in landscape. deviceScaleFactor is forced to 1 purely because
  // this harness renders in software; the real device runs at 3.
  const iphone = devices['iPhone 13 landscape'];
  const context = await browser.newContext({
    ...iphone,
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();

  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto(`http://localhost:${PORT}/?quality=low&difficulty=easy`, {
    waitUntil: 'load',
    timeout: 60000,
  });
  await page.waitForFunction(() => !!window.__pitchcraft, null, { timeout: 60000 });
  await sleep(2000);

  const vp = page.viewportSize();
  console.log(`viewport ${vp.width}x${vp.height} (landscape)\n`);

  // --- detection ----------------------------------------------------------
  console.log('setup:');
  const setup = await page.evaluate(() => ({
    isTouch: window.__pitchcraft.isTouch,
    hasTouchLayer: !!document.querySelector('.touch'),
    bodyClass: document.body.classList.contains('is-touch'),
    quality: window.__pitchcraft.scene.quality,
    pixelRatio: window.__pitchcraft.scene.renderer.getPixelRatio(),
    buttons: [...document.querySelectorAll('.tc-btn')].map((b) => b.dataset.act),
  }));
  check('touch device detected', setup.isTouch === true);
  check('on-screen controls built', setup.hasTouchLayer && setup.bodyClass);
  check('quality defaults down on mobile', setup.quality !== 'high', `quality=${setup.quality}`);
  check(
    'all six actions present',
    setup.buttons.length === 6,
    setup.buttons.join(', ')
  );

  // --- controls fit on screen --------------------------------------------
  console.log('layout:');
  const boxes = await page.evaluate(() => {
    const out = {};
    for (const sel of ['.tc-actions', '.tc-utility', '.tc-pause', '.radar', '.scorebug']) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      out[sel] = { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom };
    }
    return { boxes: out, w: innerWidth, h: innerHeight };
  });
  let allOnScreen = true;
  const offenders = [];
  for (const [sel, r] of Object.entries(boxes.boxes)) {
    const ok = r.x >= 0 && r.y >= 0 && r.right <= boxes.w + 1 && r.bottom <= boxes.h + 1;
    if (!ok) {
      allOnScreen = false;
      offenders.push(`${sel} (${r.x.toFixed(0)},${r.y.toFixed(0)} ${r.w.toFixed(0)}x${r.h.toFixed(0)})`);
    }
  }
  check('every control is fully on screen', allOnScreen, offenders.join('; '));

  const overlap = await page.evaluate(() => {
    const a = document.querySelector('.tc-actions').getBoundingClientRect();
    const b = document.querySelector('.tc-utility').getBoundingClientRect();
    return !(a.right < b.left || b.right < a.left || a.bottom < b.top || b.bottom < a.top);
  });
  check('action and utility clusters do not overlap', overlap === false);

  const touchTargets = await page.evaluate(() =>
    [...document.querySelectorAll('.tc-btn, .tc-pause')].map((b) => {
      const r = b.getBoundingClientRect();
      return { act: b.dataset.act || 'pause', size: Math.min(r.width, r.height) };
    })
  );
  const tooSmall = touchTargets.filter((t) => t.size < 44);
  check(
    'touch targets meet the 44px minimum',
    tooSmall.length === 0,
    tooSmall.map((t) => `${t.act}=${t.size.toFixed(0)}px`).join(', ')
  );

  // --- the stick actually moves the player --------------------------------
  console.log('stick:');
  await page.evaluate(() => {
    const app = window.__pitchcraft;
    // Get out of the kickoff freeze into open play.
    for (let i = 0; i < 120 * 8 && app.match.phase !== 'play'; i++) app.match.step(1 / 120);
  });
  await sleep(300);

  const startPos = await page.evaluate(() => {
    const p = window.__pitchcraft.controller.controlledPlayer;
    return { x: p.pos.x, z: p.pos.z, id: p.id };
  });

  // Drag the left side: down-screen and to the right.
  const sx = Math.round(vp.width * 0.22);
  const sy = Math.round(vp.height * 0.62);
  await page.touchscreen.tap(sx, sy); // wakes audio + proves taps land
  await sleep(100);

  const stickState = await page.evaluate(
    async ([x, y]) => {
      const send = (type, cx, cy) => {
        const ev = new PointerEvent(type, {
          pointerId: 7,
          pointerType: 'touch',
          isPrimary: true,
          clientX: cx,
          clientY: cy,
          bubbles: true,
          cancelable: true,
        });
        window.dispatchEvent(ev);
      };
      send('pointerdown', x, y);
      // Push the stick fully right — past the sprint threshold.
      for (let i = 1; i <= 10; i++) send('pointermove', x + i * 8, y);
      await new Promise((r) => setTimeout(r, 60));
      const app = window.__pitchcraft;
      const visible = !document.querySelector('[data-stick]').hidden;
      const axis = { ...app.input.axis };
      const sprint = app.input.isDown('sprint');
      return { visible, axis, sprint, touchAxis: { ...app.input.touchAxis } };
    },
    [sx, sy]
  );
  check('stick appears where you touch', stickState.visible === true);
  check(
    'stick drives the input axis',
    Math.abs(stickState.touchAxis.z) > 0.5,
    `axis=(${stickState.touchAxis.x.toFixed(2)}, ${stickState.touchAxis.z.toFixed(2)})`
  );
  check('full deflection engages sprint', stickState.sprint === true);

  // Let the game run with the stick held, and see the player move.
  await sleep(1400);
  const moved = await page.evaluate(
    ([id, x0, z0]) => {
      const app = window.__pitchcraft;
      const p = app.match.world.players.find((q) => q.id === id);
      return { d: Math.hypot(p.pos.x - x0, p.pos.z - z0), speed: p.speed };
    },
    [startPos.id, startPos.x, startPos.z]
  );
  check('the player actually moves', moved.d > 1.5, `${moved.d.toFixed(1)}m travelled, ${moved.speed.toFixed(1)} m/s`);

  await page.evaluate(() => {
    const ev = new PointerEvent('pointerup', { pointerId: 7, pointerType: 'touch', bubbles: true });
    window.dispatchEvent(ev);
  });
  await sleep(200);
  const released = await page.evaluate(() => ({
    hidden: document.querySelector('[data-stick]').hidden,
    axis: { ...window.__pitchcraft.input.axis },
    sprint: window.__pitchcraft.input.isDown('sprint'),
  }));
  check('releasing the stick stops input', released.hidden && !released.sprint && Math.hypot(released.axis.x, released.axis.z) < 0.01);

  // --- buttons reach the simulation ---------------------------------------
  console.log('buttons:');
  for (const act of ['tackle', 'switch']) {
    const fired = await page.evaluate(async (a) => {
      const app = window.__pitchcraft;
      let got = false;
      const evName = a === 'tackle' ? 'tackle' : 'switch';
      const off = app.bus.on(evName, () => (got = true));
      const btn = document.querySelector(`.tc-btn[data-act="${a}"]`);
      const r = btn.getBoundingClientRect();
      const cx = r.x + r.width / 2;
      const cy = r.y + r.height / 2;
      const mk = (t) =>
        new PointerEvent(t, {
          pointerId: 9,
          pointerType: 'touch',
          isPrimary: true,
          clientX: cx,
          clientY: cy,
          bubbles: true,
          cancelable: true,
        });
      // Put the ball near the player so a tackle is legal.
      const p = app.controller.controlledPlayer;
      const b = app.match.world.ball;
      b.frozen = false;
      b.owner = null;
      p.tackleCooldown = 0;
      b.pos.x = p.pos.x + 1.0;
      b.pos.z = p.pos.z;
      btn.dispatchEvent(mk('pointerdown'));
      for (let i = 0; i < 6; i++) app.match.step(1 / 120);
      app.input.endFrame();
      btn.dispatchEvent(mk('pointerup'));
      await new Promise((r2) => setTimeout(r2, 30));
      off();
      return got;
    }, act);
    check(`${act} button reaches the simulation`, fired === true);
  }

  const shotFired = await page.evaluate(async () => {
    const app = window.__pitchcraft;
    let got = false;
    const off = app.bus.on('shot', () => (got = true));
    // Make sure we are in open play, then give the controlled player the ball.
    for (let i = 0; i < 120 * 10 && app.match.phase !== 'play'; i++) app.match.step(1 / 120);
    const p = app.controller.controlledPlayer;
    const b = app.match.world.ball;
    b.frozen = false;
    b.owner = p;
    p.hasBall = true;
    p.kickCooldown = 0;
    p.possessionLock = 0;
    p.state = 'run';
    b.pos.x = p.pos.x + Math.sin(p.heading) * 0.6;
    b.pos.z = p.pos.z + Math.cos(p.heading) * 0.6;
    // Height matters: a ball above PLAYER.controlHeight is not under control,
    // so possession would be dropped before the charge could build.
    b.pos.y = 0.113;
    b.vel.x = b.vel.z = b.vel.y = 0;

    const btn = document.querySelector('.tc-btn[data-act="shoot"]');
    const r = btn.getBoundingClientRect();
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    const mk = (t) =>
      new PointerEvent(t, {
        pointerId: 11,
        pointerType: 'touch',
        isPrimary: true,
        clientX: cx,
        clientY: cy,
        bubbles: true,
        cancelable: true,
      });

    btn.dispatchEvent(mk('pointerdown'));
    // Hold to charge.
    for (let i = 0; i < 40; i++) {
      app.match.step(1 / 120);
      app.input.endFrame();
    }
    const charged = app.controller.charge;
    btn.dispatchEvent(mk('pointerup'));
    for (let i = 0; i < 4; i++) {
      app.match.step(1 / 120);
      app.input.endFrame();
    }
    await new Promise((r2) => setTimeout(r2, 30));
    off();
    return { got, charged };
  });
  check('shoot button builds charge while held', shotFired.charged > 0.1, `charge=${shotFired.charged.toFixed(2)}`);
  check('shoot button fires a shot on release', shotFired.got === true);

  const dimming = await page.evaluate(() => {
    const app = window.__pitchcraft;
    const b = app.match.world.ball;
    b.owner = null;
    app.controller.controlledPlayer.hasBall = false;
    app.touch.update();
    const passDim = document.querySelector('.tc-btn[data-act="pass"]').classList.contains('dim');
    const tackleDim = document.querySelector('.tc-btn[data-act="tackle"]').classList.contains('dim');
    return { passDim, tackleDim };
  });
  check('ball actions dim when you have no ball', dimming.passDim === true);
  check('tackle stays available without the ball', dimming.tackleDim === false);

  // --- pause button -------------------------------------------------------
  console.log('pause:');
  const paused = await page.evaluate(async () => {
    const btn = document.querySelector('.tc-pause');
    const r = btn.getBoundingClientRect();
    btn.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 13,
        pointerType: 'touch',
        clientX: r.x + r.width / 2,
        clientY: r.y + r.height / 2,
        bubbles: true,
        cancelable: true,
      })
    );
    await new Promise((r2) => setTimeout(r2, 120));
    return {
      paused: window.__pitchcraft.match.paused,
      overlay: !document.querySelector('[data-overlay]').hidden,
    };
  });
  check('pause button pauses', paused.paused === true);
  check('pause overlay shows', paused.overlay === true);
  await page.evaluate(() => window.__pitchcraft.resume());

  // --- portrait prompt ----------------------------------------------------
  console.log('orientation:');
  await page.setViewportSize({ width: vp.height, height: vp.width });
  await sleep(400);
  const portrait = await page.evaluate(() => {
    const el = document.getElementById('rotate');
    return getComputedStyle(el).display;
  });
  check('portrait shows a rotate prompt', portrait !== 'none', `display=${portrait}`);
  await page.setViewportSize({ width: vp.width, height: vp.height });
  await sleep(400);

  if (process.argv.includes('--shot')) {
    await page.evaluate(() => {
      const app = window.__pitchcraft;
      for (let i = 0; i < 120 * 20; i++) app.match.step(1 / 120);
    });
    await sleep(1200);
    await page.screenshot({ path: path.join(OUT, '14-mobile-landscape.png') });
    console.log('\n  captured 14-mobile-landscape.png');
  }

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
