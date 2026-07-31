import { Match, Phase } from './match/match.js';
import { GameScene } from './render/scene.js';
import { InputManager, Action } from './control/input.js';
import { PlayerController } from './control/playerController.js';
import { AudioEngine } from './audio/audio.js';
import { HUD } from './ui/hud.js';
import { PerfMonitor } from './core/perf.js';
import { SIM, MATCH } from './core/config.js';
import { EV } from './core/events.js';

/**
 * Application shell: owns the fixed-timestep loop that drives the simulation and
 * the variable-rate render that follows it.
 *
 * The simulation always advances in fixed SIM.fixedStep increments so physics
 * and AI are frame-rate independent and reproducible; rendering then draws
 * whatever the latest state is. An accumulator cap keeps a stalled tab from
 * trying to catch up on thousands of steps at once.
 */
class App {
  constructor() {
    this.canvas = document.getElementById('game');
    this.hudRoot = document.getElementById('hud');
    this.loading = document.getElementById('loading');

    this.match = new Match({ seed: (Math.random() * 1e9) | 0, humanTeam: 0 });
    this.bus = this.match.bus;

    this.input = new InputManager(window);
    this.controller = new PlayerController({
      input: this.input,
      teamId: this.match.humanTeam,
      world: this.match.world,
      bus: this.bus,
    });
    this.match.attachHumanController(this.controller);

    // Quality can be forced via ?quality=low|medium|high. The automated browser
    // harness uses `low` because it runs on a software rasteriser.
    const params = new URLSearchParams(location.search);
    const quality = ['low', 'medium', 'high'].includes(params.get('quality'))
      ? params.get('quality')
      : 'high';

    this.scene = new GameScene({
      canvas: this.canvas,
      match: this.match,
      bus: this.bus,
      quality,
    });

    this.audio = new AudioEngine(this.bus);
    this.perf = new PerfMonitor();

    this.hud = new HUD({
      root: this.hudRoot,
      match: this.match,
      bus: this.bus,
      controller: this.controller,
      audio: this.audio,
      app: this,
    });

    this.accumulator = 0;
    this.lastTime = 0;
    this.running = true;
    this.showPerf = false;

    this.bindGlobal();
    this.scene.cameraRig.snapTo(this.match.world.ball);

    if (this.loading) this.loading.remove();

    // Expose for the automated browser tests and screenshot tooling.
    window.__pitchcraft = this;
  }

  bindGlobal() {
    window.addEventListener('resize', () => this.scene.resize());

    // Audio can only start from a gesture.
    const kick = () => {
      this.audio.start();
      this.audio.resume();
    };
    window.addEventListener('pointerdown', kick, { once: true });
    window.addEventListener('keydown', kick, { once: true });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') {
        this.showPerf = !this.showPerf;
        this.perf.enabled = this.showPerf;
        if (!this.showPerf) this.hud.setPerf(null);
        e.preventDefault();
      }
    });
  }

  pause() {
    if (this.match.phase === Phase.FULL_TIME) return;
    if (!this.match.paused) this.match.togglePause();
    this.hud.showPause();
  }

  resume() {
    if (this.match.paused) this.match.togglePause();
    this.hud.hideOverlay();
  }

  restart() {
    this.match.resetMatch((Math.random() * 1e9) | 0);
    this.controller.selectNearestToBall();
    this.hud.hideOverlay();
    this.accumulator = 0;
  }

  /** One frame. */
  frame(now) {
    const time = now * 0.001;
    let dt = this.lastTime ? time - this.lastTime : 0;
    this.lastTime = time;
    dt = Math.min(dt, 0.25);

    this.perf.sample(dt);

    this.input.poll();

    // Camera-relative movement: tell the controller which way "forward" is.
    const fwd = this.scene.cameraRig.groundForward();
    this.controller.setCameraBasis(fwd.x, fwd.z);

    this.handleGlobalActions();

    // --- fixed-step simulation --------------------------------------------
    this.accumulator = Math.min(this.accumulator + dt, SIM.maxAccumulator);
    let steps = 0;
    while (this.accumulator >= SIM.fixedStep && steps < SIM.maxSubSteps) {
      this.match.step(SIM.fixedStep);
      this.accumulator -= SIM.fixedStep;
      steps++;
    }
    // If we blew the sub-step budget the tab was stalled; drop the backlog
    // rather than spiralling.
    if (steps >= SIM.maxSubSteps) this.accumulator = 0;

    this.input.endFrame();

    // --- render ------------------------------------------------------------
    this.scene.update(dt, this.controller.controlledPlayer);
    this.scene.render();

    this.hud.update(dt);
    this.audio.update(dt, this.scene.excitement);

    if (this.showPerf && this.perf.poll()) {
      this.hud.setPerf(this.perf.report(this.scene.renderer));
    }

    requestAnimationFrame(this.frame.bind(this));
  }

  handleGlobalActions() {
    const input = this.input;

    if (input.wasPressed(Action.PAUSE)) {
      if (this.match.phase === Phase.FULL_TIME) return;
      if (this.match.paused) this.resume();
      else this.pause();
    }

    if (input.wasPressed(Action.CAMERA)) {
      this.scene.cameraRig.toggleMode();
      this.bus.emit(EV.UI, { tone: 480 });
    }

    if (input.wasPressed(Action.RESTART)) {
      this.restart();
    }
  }

  start() {
    requestAnimationFrame(this.frame.bind(this));
  }
}

function boot() {
  try {
    const app = new App();
    app.start();
  } catch (err) {
    console.error('[pitchcraft] failed to start', err);
    const el = document.getElementById('loading');
    if (el) {
      el.innerHTML = `<div class="err"><h1>Could not start Pitchcraft</h1><pre>${
        (err && err.message) || err
      }</pre><p>WebGL is required. Try a recent Chrome, Edge, Firefox or Safari.</p></div>`;
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
