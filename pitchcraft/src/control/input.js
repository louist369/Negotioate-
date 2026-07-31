/**
 * Input abstraction. Keyboard is the primary path; a connected gamepad is
 * polled and merged on top. Everything downstream reads the same `state` object,
 * so the controller code has no idea which device produced an action.
 */

export const Action = {
  PASS: 'pass',
  THROUGH: 'through',
  LOFT: 'loft',
  SHOOT: 'shoot',
  TACKLE: 'tackle',
  SWITCH: 'switch',
  SKILL: 'skill',
  SPRINT: 'sprint',
  PAUSE: 'pause',
  CAMERA: 'camera',
  RESTART: 'restart',
};

const KEY_MAP = {
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  ShiftLeft: Action.SPRINT,
  ShiftRight: Action.SPRINT,
  KeyJ: Action.PASS,
  KeyH: Action.THROUGH,
  KeyL: Action.LOFT,
  KeyK: Action.SHOOT,
  Space: Action.TACKLE,
  KeyQ: Action.SWITCH,
  Tab: Action.SWITCH,
  KeyE: Action.SKILL,
  KeyP: Action.PAUSE,
  Escape: Action.PAUSE,
  KeyC: Action.CAMERA,
  KeyR: Action.RESTART,
};

// Xbox-style layout; most modern pads report this mapping.
const PAD_BUTTONS = {
  0: Action.PASS,
  1: Action.SHOOT,
  2: Action.THROUGH,
  3: Action.LOFT,
  4: Action.SWITCH,
  5: Action.TACKLE,
  7: Action.SPRINT,
  9: Action.PAUSE,
  8: Action.RESTART,
};

export class InputManager {
  constructor(target = typeof window !== 'undefined' ? window : null) {
    this.target = target;
    this.dirs = { up: false, down: false, left: false, right: false };
    this.held = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.axis = { x: 0, z: 0 };
    this.gamepadIndex = null;
    this.padPrev = [];
    this.enabled = true;
    this.lastDevice = 'keyboard';

    if (target) this.bind();
  }

  bind() {
    this.onKeyDown = (e) => {
      if (!this.enabled) return;
      const action = KEY_MAP[e.code];
      if (!action) return;
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      this.lastDevice = 'keyboard';
      if (action in this.dirs) {
        this.dirs[action] = true;
        return;
      }
      if (!this.held.has(action)) this.pressed.add(action);
      this.held.add(action);
    };

    this.onKeyUp = (e) => {
      const action = KEY_MAP[e.code];
      if (!action) return;
      if (action in this.dirs) {
        this.dirs[action] = false;
        return;
      }
      if (this.held.has(action)) this.released.add(action);
      this.held.delete(action);
    };

    this.onBlur = () => this.reset();

    this.target.addEventListener('keydown', this.onKeyDown);
    this.target.addEventListener('keyup', this.onKeyUp);
    this.target.addEventListener('blur', this.onBlur);
    this.target.addEventListener('gamepadconnected', (e) => {
      this.gamepadIndex = e.gamepad.index;
    });
    this.target.addEventListener('gamepaddisconnected', () => {
      this.gamepadIndex = null;
    });
  }

  dispose() {
    if (!this.target) return;
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('blur', this.onBlur);
  }

  reset() {
    this.dirs.up = this.dirs.down = this.dirs.left = this.dirs.right = false;
    this.held.clear();
    this.pressed.clear();
    this.released.clear();
  }

  /** Call once per frame *before* reading state. */
  poll() {
    // Keyboard direction → analogue-ish axis.
    let x = 0;
    let z = 0;
    if (this.dirs.up) x += 1;
    if (this.dirs.down) x -= 1;
    if (this.dirs.left) z -= 1;
    if (this.dirs.right) z += 1;

    this.axis.x = x;
    this.axis.z = z;

    this.pollGamepad();

    const l = Math.hypot(this.axis.x, this.axis.z);
    if (l > 1) {
      this.axis.x /= l;
      this.axis.z /= l;
    }
  }

  pollGamepad() {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return;
    const pads = navigator.getGamepads();
    let pad = this.gamepadIndex !== null ? pads[this.gamepadIndex] : null;
    if (!pad) {
      for (const p of pads) {
        if (p && p.connected) {
          pad = p;
          this.gamepadIndex = p.index;
          break;
        }
      }
    }
    if (!pad) return;

    const dead = 0.22;
    const ax = pad.axes[1] ?? 0; // forward/back
    const az = pad.axes[0] ?? 0; // left/right
    const mag = Math.hypot(ax, az);
    if (mag > dead) {
      this.lastDevice = 'gamepad';
      // Screen-forward is -axis[1]; the sim's +x is "up the pitch".
      this.axis.x = -ax;
      this.axis.z = az;
    }

    for (const [idxStr, action] of Object.entries(PAD_BUTTONS)) {
      const idx = Number(idxStr);
      const btn = pad.buttons[idx];
      const down = !!btn && (btn.pressed || btn.value > 0.5);
      const prev = this.padPrev[idx] || false;
      if (down && !prev) {
        this.pressed.add(action);
        this.held.add(action);
        this.lastDevice = 'gamepad';
      } else if (!down && prev) {
        this.released.add(action);
        this.held.delete(action);
      }
      this.padPrev[idx] = down;
    }
  }

  /** Call once per frame *after* consuming state. */
  endFrame() {
    this.pressed.clear();
    this.released.clear();
  }

  isDown(action) {
    return this.held.has(action);
  }

  wasPressed(action) {
    return this.pressed.has(action);
  }

  wasReleased(action) {
    return this.released.has(action);
  }

  get hasGamepad() {
    return this.gamepadIndex !== null;
  }
}

/** Headless stub so the simulation and tests can run without a DOM. */
export class NullInput extends InputManager {
  constructor() {
    super(null);
  }
  poll() {}
  endFrame() {
    this.pressed.clear();
    this.released.clear();
  }
}
