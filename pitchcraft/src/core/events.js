/**
 * Minimal synchronous event bus. The simulation emits gameplay events; the
 * renderer, audio layer and UI subscribe. Keeping this one-way means the sim
 * never needs to know a renderer exists.
 */
export class EventBus {
  constructor() {
    this.handlers = new Map();
    this.queue = [];
  }

  on(type, fn) {
    let list = this.handlers.get(type);
    if (!list) {
      list = [];
      this.handlers.set(type, list);
    }
    list.push(fn);
    return () => this.off(type, fn);
  }

  off(type, fn) {
    const list = this.handlers.get(type);
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }

  emit(type, payload) {
    this.queue.push({ type, payload });
    const list = this.handlers.get(type);
    if (list) {
      for (let i = 0; i < list.length; i++) list[i](payload, type);
    }
    const any = this.handlers.get('*');
    if (any) {
      for (let i = 0; i < any.length; i++) any[i](payload, type);
    }
  }

  /** Drain the recorded event log — used by tests and the replay/debug overlay. */
  drain() {
    const q = this.queue;
    this.queue = [];
    return q;
  }

  clear() {
    this.handlers.clear();
    this.queue.length = 0;
  }
}

/** Canonical event names, so typos surface as undefined rather than silent no-ops. */
export const EV = {
  KICK: 'kick',
  PASS: 'pass',
  SHOT: 'shot',
  TACKLE: 'tackle',
  TACKLE_WON: 'tackleWon',
  INTERCEPT: 'intercept',
  TOUCH: 'touch',
  POSSESSION: 'possession',
  GOAL: 'goal',
  POST: 'post',
  SAVE: 'save',
  CATCH: 'catch',
  OUT_OF_PLAY: 'outOfPlay',
  RESTART: 'restart',
  RESTART_TAKEN: 'restartTaken',
  KICKOFF: 'kickoff',
  WHISTLE: 'whistle',
  FULL_TIME: 'fullTime',
  SWITCH: 'switch',
  STUMBLE: 'stumble',
  MATCH_RESET: 'matchReset',
  STATE: 'state',
  UI: 'ui',
};
