import { Action } from './input.js';

/**
 * Touch controls.
 *
 * Feeds the same `InputManager` surface the keyboard and gamepad do, so nothing
 * downstream knows or cares which device produced an action.
 *
 * Layout, for landscape on a phone held in two hands:
 *   left thumb  — a floating analogue stick. It recentres wherever you first
 *                 touch the left half of the screen, so you never have to look
 *                 for it. Pushing past ~82% of its radius engages sprint, which
 *                 saves a button.
 *   right thumb — an action arc. PASS and SHOOT are the large, closest targets;
 *                 LOB and THRU sit above them. TACKLE and SWITCH are separate
 *                 and always available, because needing them is exactly when you
 *                 do *not* have the ball.
 *
 * Buttons dim when the action is unavailable rather than changing meaning —
 * a button that silently becomes a different action is how you shoot when you
 * meant to tackle.
 */

const STICK_RADIUS = 62;
const SPRINT_AT = 0.82;

export class TouchControls {
  /**
   * @param {object} opts
   * @param {HTMLElement} opts.root  container to build the controls into
   * @param {InputManager} opts.input
   * @param {() => boolean} opts.hasBall  whether the controlled player has the ball
   */
  constructor({ root, input, hasBall, onPause }) {
    this.input = input;
    this.hasBall = hasBall || (() => false);
    this.onPause = onPause || (() => {});
    this.root = root;

    this.stickId = null;
    this.stickOrigin = { x: 0, y: 0 };
    this.sprinting = false;
    this.buttons = [];

    this.build();
    this.bind();
  }

  build() {
    const el = document.createElement('div');
    el.className = 'touch';
    el.innerHTML = `
      <div class="tc-stick" data-stick hidden>
        <div class="tc-stick-base"></div>
        <div class="tc-stick-knob" data-knob></div>
      </div>
      <div class="tc-actions">
        <button class="tc-btn tc-sm" data-act="through">THRU</button>
        <button class="tc-btn tc-sm" data-act="loft">LOB</button>
        <button class="tc-btn tc-lg" data-act="pass">PASS</button>
        <button class="tc-btn tc-lg tc-shoot" data-act="shoot">SHOOT</button>
      </div>
      <div class="tc-utility">
        <button class="tc-btn tc-md" data-act="tackle">TACKLE</button>
        <button class="tc-btn tc-md" data-act="switch">SWITCH</button>
      </div>
      <button class="tc-pause" data-pause aria-label="Pause">II</button>
      <div class="tc-hint" data-hint>Drag the left side to move · push to the edge to sprint</div>
    `;
    this.root.appendChild(el);

    this.el = el;
    this.stick = el.querySelector('[data-stick]');
    this.knob = el.querySelector('[data-knob]');
    this.hint = el.querySelector('[data-hint]');

    // No Esc key on a phone.
    el.querySelector('[data-pause]').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onPause();
    });

    const ACTIONS = {
      pass: Action.PASS,
      shoot: Action.SHOOT,
      loft: Action.LOFT,
      through: Action.THROUGH,
      tackle: Action.TACKLE,
      switch: Action.SWITCH,
    };

    for (const btn of el.querySelectorAll('.tc-btn')) {
      const action = ACTIONS[btn.dataset.act];
      // Only these are meaningful without the ball.
      const needsBall = !['tackle', 'switch'].includes(btn.dataset.act);
      this.buttons.push({ el: btn, action, needsBall, pointerId: null });
    }
  }

  bind() {
    const el = this.el;

    // One handler set on the container, using pointer capture per button, so a
    // thumb that slides off a button still releases it correctly.
    for (const b of this.buttons) {
      b.el.addEventListener(
        'pointerdown',
        (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (b.pointerId !== null) return;
          b.pointerId = e.pointerId;
          b.el.classList.add('on');
          // Register the press FIRST. Pointer capture is only a convenience so
          // that a thumb sliding off the button still releases it; if it throws
          // (and it can) the button must still have done its job.
          this.input.pressAction(b.action);
          try {
            b.el.setPointerCapture(e.pointerId);
          } catch {
            /* capture unavailable — pointerup on the window still releases it */
          }
        },
        { passive: false }
      );

      const release = (e) => {
        if (b.pointerId !== e.pointerId) return;
        b.pointerId = null;
        b.el.classList.remove('on');
        this.input.releaseAction(b.action);
      };
      b.el.addEventListener('pointerup', release);
      b.el.addEventListener('pointercancel', release);
      b.el.addEventListener('lostpointercapture', release);
      // Safety net for the case where capture was refused and the thumb lifted
      // somewhere else entirely: a held button that never releases would leave
      // the player permanently charging a shot.
      window.addEventListener('pointerup', release);
      window.addEventListener('pointercancel', release);
    }

    // The stick claims any pointer that starts on the left half and did not
    // land on a button.
    const onDown = (e) => {
      if (this.stickId !== null) return;
      if (e.clientX > window.innerWidth * 0.5) return;
      e.preventDefault();
      this.stickId = e.pointerId;
      this.stickOrigin.x = e.clientX;
      this.stickOrigin.y = e.clientY;
      this.stick.hidden = false;
      this.stick.style.left = `${e.clientX}px`;
      this.stick.style.top = `${e.clientY}px`;
      this.knob.style.transform = 'translate(-50%, -50%)';
      if (this.hint) this.hint.classList.add('gone');
    };

    const onMove = (e) => {
      if (this.stickId !== e.pointerId) return;
      e.preventDefault();
      let dx = e.clientX - this.stickOrigin.x;
      let dy = e.clientY - this.stickOrigin.y;
      const len = Math.hypot(dx, dy);
      const clamped = Math.min(len, STICK_RADIUS);
      if (len > 0.001) {
        dx = (dx / len) * clamped;
        dy = (dy / len) * clamped;
      }
      this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;

      // Screen up = forward. `axis.x` is camera-forward, `axis.z` camera-right,
      // matching the keyboard mapping exactly.
      const nx = dx / STICK_RADIUS;
      const ny = dy / STICK_RADIUS;
      this.input.setTouchAxis(-ny, nx);

      const push = clamped / STICK_RADIUS;
      const wantSprint = push > SPRINT_AT;
      if (wantSprint !== this.sprinting) {
        this.sprinting = wantSprint;
        if (wantSprint) this.input.pressAction(Action.SPRINT);
        else this.input.releaseAction(Action.SPRINT);
        this.stick.classList.toggle('sprint', wantSprint);
      }
    };

    const onUp = (e) => {
      if (this.stickId !== e.pointerId) return;
      this.stickId = null;
      this.stick.hidden = true;
      this.stick.classList.remove('sprint');
      this.input.setTouchAxis(0, 0);
      if (this.sprinting) {
        this.sprinting = false;
        this.input.releaseAction(Action.SPRINT);
      }
    };

    window.addEventListener('pointerdown', onDown, { passive: false });
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);

    // Stop iOS rubber-band scrolling and double-tap zoom over the game.
    document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    document.addEventListener('gesturestart', (e) => e.preventDefault());
  }

  /** Dim the actions that need the ball when the player doesn't have it. */
  update() {
    const has = this.hasBall();
    for (const b of this.buttons) {
      if (!b.needsBall) continue;
      b.el.classList.toggle('dim', !has);
    }
  }

  dispose() {
    this.el.remove();
  }
}

/** True on a device whose primary input is touch. `?touch=1` forces it on. */
export function isTouchDevice() {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(location.search);
  if (params.get('touch') === '1') return true;
  if (params.get('touch') === '0') return false;
  return (
    'ontouchstart' in window ||
    (navigator.maxTouchPoints || 0) > 0 ||
    window.matchMedia('(pointer: coarse)').matches
  );
}
