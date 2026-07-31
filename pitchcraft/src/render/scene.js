import * as THREE from 'three';
import { buildPitch } from './pitch.js';
import { buildStadium } from './stadium.js';
import { createPlayer } from './character.js';
import { animatePlayer, createAnimState } from './animation.js';
import { BroadcastCamera } from './camera.js';
import { Effects, createBall, ContactShadows } from './effects.js';
import { TEAMS, GRAPHICS, PITCH, BALL, HALF_LENGTH } from '../core/config.js';
import { EV } from '../core/events.js';
import { clamp } from '../core/vec.js';

/**
 * The renderer. Owns the Three.js scene and mirrors simulation state onto it
 * every frame. Strictly one-way: nothing here writes back into the sim, so the
 * game is fully playable (and testable) headless.
 */
export class GameScene {
  constructor({ canvas, match, bus, quality = 'high' }) {
    this.match = match;
    this.bus = bus;
    this.quality = quality;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: quality !== 'low',
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'high' ? 2 : 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    this.renderer.shadowMap.enabled = quality !== 'low';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#070b14');
    this.scene.fog = new THREE.Fog('#0a1020', 90, 260);

    this.cameraRig = new BroadcastCamera(this.aspect);

    this.buildLighting();

    this.pitch = buildPitch(this.renderer);
    this.scene.add(this.pitch);

    const stadium = buildStadium(this.renderer, quality === 'low' ? 0.18 : quality === 'medium' ? 0.55 : 1);
    this.scene.add(stadium.group);
    this.crowd = stadium.crowd;

    this.ballMesh = createBall(this.renderer);
    this.scene.add(this.ballMesh);
    this.ballQuat = new THREE.Quaternion();
    this.rollAxis = new THREE.Vector3();

    this.effects = new Effects();
    this.scene.add(this.effects.group);

    // Contact shadows: one per player plus one for the ball.
    this.contact = new ContactShadows(match.world.players.length + 1);
    this.scene.add(this.contact.mesh);

    this.players = new Map();
    this.buildPlayers();

    this.selectionRing = this.buildSelectionRing();
    this.scene.add(this.selectionRing);

    this.excitement = 0;
    this.time = 0;

    this.bindEvents();
    this.resize();
  }

  get aspect() {
    const c = this.renderer.domElement;
    return (c.clientWidth || 16) / (c.clientHeight || 9);
  }

  buildLighting() {
    // Evening floodlit look: cool ambient fill, warm key from above.
    const hemi = new THREE.HemisphereLight(0x9fc4ff, 0x1d3320, 0.55);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xfff2dc, 2.15);
    key.position.set(38, 62, 30);
    key.castShadow = this.quality !== 'low';
    key.shadow.mapSize.set(GRAPHICS.shadowMapSize, GRAPHICS.shadowMapSize);
    key.shadow.camera.near = 20;
    key.shadow.camera.far = 190;
    const span = Math.max(PITCH.length, PITCH.width) * 0.62;
    key.shadow.camera.left = -span;
    key.shadow.camera.right = span;
    key.shadow.camera.top = span;
    key.shadow.camera.bottom = -span;
    key.shadow.bias = -0.0007;
    key.shadow.normalBias = 0.035;
    this.scene.add(key);
    this.keyLight = key;

    // Opposing fill so players aren't black on the shadow side.
    const fill = new THREE.DirectionalLight(0xbcd6ff, 0.62);
    fill.position.set(-40, 45, -28);
    this.scene.add(fill);

    const rim = new THREE.DirectionalLight(0xffd9a0, 0.4);
    rim.position.set(0, 22, -60);
    this.scene.add(rim);

    this.scene.add(new THREE.AmbientLight(0x27324a, 0.7));
  }

  buildPlayers() {
    for (const p of this.match.world.players) {
      const built = createPlayer(p, TEAMS[p.team]);
      built.animState = createAnimState();
      this.scene.add(built.root);
      this.players.set(p.id, built);
    }
  }

  /** Ring under the human-controlled player. */
  buildSelectionRing() {
    const geo = new THREE.RingGeometry(0.62, 0.82, 40);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffe14d,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.03;
    m.renderOrder = 4;
    m.visible = false;
    return m;
  }

  bindEvents() {
    const bus = this.bus;

    bus.on(EV.GOAL, (e) => {
      this.excitement = 1;
      const t = TEAMS[e.team];
      const scorer = e.scorer;
      this.effects.goalConfetti(
        scorer ? scorer.pos.x : 0,
        scorer ? scorer.pos.z : 0,
        t.colors.primary,
        t.colors.accent
      );
      this.cameraRig.addShake(0.5);
      if (scorer) this.cameraRig.startCelebration(scorer.pos);
    });

    bus.on(EV.KICKOFF, () => {
      this.cameraRig.stopCelebration();
      this.cameraRig.snapTo(this.match.world.ball);
    });

    bus.on(EV.POST, (e) => {
      this.effects.impactSparks(e.pos.x, e.pos.y ?? 1, e.pos.z, 14);
      this.cameraRig.addShake(0.28);
      this.excitement = Math.max(this.excitement, 0.75);
    });

    bus.on(EV.SHOT, () => {
      this.excitement = Math.max(this.excitement, 0.55);
    });

    bus.on(EV.SAVE, (e) => {
      if (!e.attempt) this.excitement = Math.max(this.excitement, 0.7);
    });

    bus.on(EV.TACKLE, (e) => {
      if (e.pos) {
        const p = e.player;
        this.effects.turfSpray(e.pos.x, e.pos.z, Math.sin(p.heading), Math.cos(p.heading), 16);
      }
      this.cameraRig.addShake(0.12);
    });

    bus.on(EV.MATCH_RESET, () => {
      this.excitement = 0;
      this.cameraRig.stopCelebration();
      this.cameraRig.snapTo(this.match.world.ball);
    });
  }

  resize() {
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.cameraRig.setAspect(w / h);
  }

  /**
   * Sync the scene to the simulation.
   * @param {number} dt   real frame time
   * @param {Player|null} controlled
   */
  update(dt, controlled) {
    this.time += dt;
    const world = this.match.world;
    const ball = world.ball;

    // --- players -----------------------------------------------------------
    let ci = 0;
    for (const p of world.players) {
      const built = this.players.get(p.id);
      if (!built) continue;
      animatePlayer(built, p, built.animState, dt, this.time);

      // Contact shadow scales with how airborne the player is.
      const lift = built.root.position.y;
      this.contact.set(ci++, p.pos.x, p.pos.z, 0.45 * (1 - clamp(lift, 0, 0.6)), 1);
    }

    // --- ball --------------------------------------------------------------
    this.ballMesh.position.set(ball.pos.x, ball.pos.y, ball.pos.z);
    if (ball.rollAngle !== this._lastRoll) {
      const delta = ball.rollAngle - (this._lastRoll ?? ball.rollAngle);
      this._lastRoll = ball.rollAngle;
      if (Math.abs(delta) > 1e-5) {
        this.rollAxis.set(ball.rollAxis.x, ball.rollAxis.y, ball.rollAxis.z);
        if (this.rollAxis.lengthSq() > 1e-6) {
          this.rollAxis.normalize();
          this.ballQuat.setFromAxisAngle(this.rollAxis, delta);
          this.ballMesh.quaternion.premultiply(this.ballQuat);
        }
      }
    }
    // Ball shadow shrinks and fades as it rises.
    const bh = clamp(ball.pos.y / 6, 0, 1);
    this.contact.set(ci++, ball.pos.x, ball.pos.z, BALL.radius * 2.2 * (1 - bh * 0.65), 1);
    this.contact.commit();

    // --- selection ring ----------------------------------------------------
    if (controlled) {
      this.selectionRing.visible = true;
      this.selectionRing.position.set(controlled.pos.x, 0.03, controlled.pos.z);
      const pulse = 0.85 + Math.sin(this.time * 6) * 0.12;
      this.selectionRing.scale.setScalar(pulse);
    } else {
      this.selectionRing.visible = false;
    }

    // --- camera, crowd, effects -------------------------------------------
    this.cameraRig.update(dt, ball, world.players, controlled);

    // Excitement decays; proximity to either goal keeps it simmering.
    const dangerous = Math.abs(ball.pos.x) > HALF_LENGTH - 22 ? 0.22 : 0;
    this.excitement = Math.max(dangerous, this.excitement - dt * 0.35);
    this.crowd.update(this.time, this.excitement);

    this.effects.update(dt, ball);
  }

  render() {
    this.renderer.render(this.scene, this.cameraRig.camera);
  }

  get camera() {
    return this.cameraRig.camera;
  }

  dispose() {
    this.renderer.dispose();
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (m.map) m.map.dispose();
          m.dispose();
        }
      }
    });
  }
}
