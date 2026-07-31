import * as THREE from 'three';
import { CAMERA, PITCH, HALF_LENGTH, HALF_WIDTH } from '../core/config.js';
import { clamp, lerp } from '../core/vec.js';

/**
 * Broadcast camera.
 *
 * Sits on the near touchline and tracks a *smoothed point of interest* rather
 * than the ball itself — following the ball exactly produces the nauseating
 * jitter that makes so many football prototypes unwatchable. The interest point
 * leads the ball slightly and is pulled toward the action's centre of mass, and
 * the camera dollies along the touchline while dynamically adjusting height and
 * distance so the useful passing options stay on screen.
 */
export class BroadcastCamera {
  constructor(aspect = 16 / 9) {
    this.camera = new THREE.PerspectiveCamera(CAMERA.broadcast.fov, aspect, 0.5, 400);
    this.mode = 'broadcast';

    this.interest = new THREE.Vector3(0, 0, 0);
    this.lookAt = new THREE.Vector3(0, 0, 0);
    this.position = new THREE.Vector3(0, CAMERA.broadcast.height, CAMERA.broadcast.distance);
    this.camera.position.copy(this.position);

    this.shake = 0;
    this.shakeSeed = Math.random() * 100;
    this.zoomBias = 0;
    this.targetFov = CAMERA.broadcast.fov;

    // Cinematic override, used for goal celebrations.
    this.cinematic = null;
    this.cinematicTime = 0;
  }

  get config() {
    return this.mode === 'close' ? CAMERA.close : CAMERA.broadcast;
  }

  toggleMode() {
    this.mode = this.mode === 'broadcast' ? 'close' : 'broadcast';
    this.targetFov = this.config.fov;
    return this.mode;
  }

  setAspect(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Camera-forward direction projected onto the ground, for input mapping. */
  groundForward(out = { x: 0, z: 0 }) {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const l = Math.hypot(dir.x, dir.z) || 1;
    out.x = dir.x / l;
    out.z = dir.z / l;
    return out;
  }

  addShake(amount) {
    this.shake = Math.min(1.2, this.shake + amount);
  }

  /** Swing around the scorer for a few seconds after a goal. */
  startCelebration(focus) {
    this.cinematic = { x: focus.x, z: focus.z };
    this.cinematicTime = 0;
  }

  stopCelebration() {
    this.cinematic = null;
  }

  /**
   * @param {object} ball  simulation ball
   * @param {Player[]} players
   * @param {Player|null} controlled
   */
  update(dt, ball, players, controlled) {
    const cfg = this.config;

    if (this.cinematic) {
      this.updateCinematic(dt);
      return;
    }

    // --- point of interest -------------------------------------------------
    // Lead the ball by its own velocity, then bias toward the controlled player
    // so the human's man is never pushed off screen.
    let ix = ball.pos.x + ball.vel.x * cfg.lookAhead * 0.06;
    let iz = ball.pos.z + ball.vel.z * cfg.lookAhead * 0.06;

    if (controlled) {
      ix = lerp(ix, controlled.pos.x, 0.22);
      iz = lerp(iz, controlled.pos.z, 0.22);
    }

    // Pull toward the centre of mass of nearby players so the framing shows the
    // shape of the play rather than an isolated ball.
    let cx = 0;
    let cz = 0;
    let w = 0;
    for (const p of players) {
      const d = Math.hypot(p.pos.x - ball.pos.x, p.pos.z - ball.pos.z);
      const weight = 1 / (1 + d * 0.18);
      cx += p.pos.x * weight;
      cz += p.pos.z * weight;
      w += weight;
    }
    if (w > 0) {
      ix = lerp(ix, cx / w, 0.3);
      iz = lerp(iz, cz / w, 0.34);
    }

    // Keep the camera from drifting past the ends of the pitch.
    ix = clamp(ix, -HALF_LENGTH * cfg.maxLateral, HALF_LENGTH * cfg.maxLateral);
    iz = clamp(iz, -HALF_WIDTH * 0.85, HALF_WIDTH * 0.85);

    // Critically-damped follow — no overshoot, no jitter.
    const k = 1 - Math.exp(-cfg.followLag * dt);
    this.interest.x = lerp(this.interest.x, ix, k);
    this.interest.z = lerp(this.interest.z, iz, k);

    // --- framing -----------------------------------------------------------
    // Zoom out when play is stretched, in when it's tight in a box.
    const spread = this.playSpread(players, ball);
    const zoomT = clamp((spread - 16) / 26, 0, 1);
    const distance =
      this.mode === 'broadcast'
        ? lerp(CAMERA.broadcast.zoomNear, CAMERA.broadcast.zoomFar, zoomT)
        : cfg.distance;
    const height = cfg.height * lerp(0.92, 1.08, zoomT);

    // The camera sits on the near touchline, offset back from the interest point.
    const targetX = this.interest.x;
    const targetZ = this.interest.z * 0.28 + distance;

    const pk = 1 - Math.exp(-cfg.followLag * 0.85 * dt);
    this.position.x = lerp(this.position.x, targetX, pk);
    this.position.y = lerp(this.position.y, height, pk);
    this.position.z = lerp(this.position.z, targetZ, pk);

    this.lookAt.x = lerp(this.lookAt.x, this.interest.x, k);
    this.lookAt.y = lerp(this.lookAt.y, Math.min(ball.pos.y * 0.35, 2.5), k);
    this.lookAt.z = lerp(this.lookAt.z, this.interest.z, k);

    this.applyTransform(dt);
  }

  /** Radius containing the players who matter, used to drive the zoom. */
  playSpread(players, ball) {
    let maxD = 0;
    let count = 0;
    for (const p of players) {
      const d = Math.hypot(p.pos.x - ball.pos.x, p.pos.z - ball.pos.z);
      if (d < 34) {
        maxD = Math.max(maxD, d);
        count++;
      }
    }
    return count > 2 ? maxD : 20;
  }

  updateCinematic(dt) {
    this.cinematicTime += dt;
    const t = this.cinematicTime;
    // Slow orbit around the celebration, pulled in tight.
    const angle = -0.5 + t * 0.42;
    const radius = lerp(17, 23, clamp(t / 4, 0, 1));
    const c = this.cinematic;

    const tx = c.x + Math.sin(angle) * radius;
    const tz = c.z + Math.cos(angle) * radius;
    const ty = lerp(6.5, 11, clamp(t / 4, 0, 1));

    const k = 1 - Math.exp(-3.5 * dt);
    this.position.x = lerp(this.position.x, tx, k);
    this.position.y = lerp(this.position.y, ty, k);
    this.position.z = lerp(this.position.z, tz, k);

    this.lookAt.x = lerp(this.lookAt.x, c.x, k);
    this.lookAt.y = lerp(this.lookAt.y, 1.2, k);
    this.lookAt.z = lerp(this.lookAt.z, c.z, k);

    this.applyTransform(dt);
  }

  applyTransform(dt) {
    this.camera.position.copy(this.position);

    if (this.shake > 0.001) {
      const s = this.shake;
      const t = performance.now() * 0.001 + this.shakeSeed;
      this.camera.position.x += Math.sin(t * 43.0) * s * 0.35;
      this.camera.position.y += Math.sin(t * 37.0) * s * 0.28;
      this.camera.position.z += Math.cos(t * 51.0) * s * 0.22;
      this.shake = Math.max(0, this.shake - dt * 2.2);
    }

    this.camera.lookAt(this.lookAt);

    const fov = this.camera.fov;
    if (Math.abs(fov - this.targetFov) > 0.01) {
      this.camera.fov = lerp(fov, this.targetFov, 1 - Math.exp(-6 * dt));
      this.camera.updateProjectionMatrix();
    }
  }

  /** Snap immediately, used at kickoff and after a reset so there's no swoop. */
  snapTo(ball) {
    const cfg = this.config;
    this.interest.set(ball.pos.x, 0, ball.pos.z);
    this.position.set(ball.pos.x, cfg.height, ball.pos.z * 0.28 + cfg.distance);
    this.lookAt.set(ball.pos.x, 0, ball.pos.z);
    this.camera.position.copy(this.position);
    this.camera.lookAt(this.lookAt);
  }
}
