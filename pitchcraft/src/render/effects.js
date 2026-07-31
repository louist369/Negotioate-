import * as THREE from 'three';
import { BALL } from '../core/config.js';
import { makeRadialTexture, makeBallTexture } from './textures.js';
import { clamp } from '../core/vec.js';

/**
 * Ball mesh plus the transient visual effects: contact shadows, turf spray on
 * tackles, a speed trail on struck balls, and goal confetti.
 *
 * All particle systems are fixed-size pools written into a single BufferGeometry
 * each, so effects never allocate during play.
 */

export function createBall(renderer) {
  const tex = makeBallTexture(renderer);
  const geo = new THREE.SphereGeometry(BALL.radius, 22, 16);
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.42,
    metalness: 0.02,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.name = 'ball';
  return mesh;
}

/** Soft blob shadows under the ball and every player — cheap contact grounding. */
export class ContactShadows {
  constructor(count) {
    const tex = makeRadialTexture('rgba(0,0,0,0.5)', 'rgba(0,0,0,0)');
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      opacity: 0.75,
    });
    const geo = new THREE.PlaneGeometry(1, 1);
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.dummy = new THREE.Object3D();
    this.count = count;
  }

  set(index, x, z, radius, opacity) {
    const d = this.dummy;
    d.position.set(x, 0.02, z);
    d.rotation.set(-Math.PI / 2, 0, 0);
    d.scale.set(radius * 2, radius * 2, 1);
    d.updateMatrix();
    this.mesh.setMatrixAt(index, d.matrix);
  }

  commit() {
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** Generic GPU-friendly particle pool. */
class ParticlePool {
  constructor(count, material, size = 0.2) {
    this.count = count;
    this.positions = new Float32Array(count * 3);
    this.velocities = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count);
    this.colors = new Float32Array(count * 3);
    this.sizes = new Float32Array(count);
    this.cursor = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));
    this.geometry = geo;

    this.points = new THREE.Points(geo, material);
    this.points.frustumCulled = false;

    // Park all particles far below the pitch until they're used.
    for (let i = 0; i < count; i++) this.positions[i * 3 + 1] = -1000;
  }

  spawn(x, y, z, vx, vy, vz, life, color, size) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.count;
    this.positions[i * 3] = x;
    this.positions[i * 3 + 1] = y;
    this.positions[i * 3 + 2] = z;
    this.velocities[i * 3] = vx;
    this.velocities[i * 3 + 1] = vy;
    this.velocities[i * 3 + 2] = vz;
    this.life[i] = life;
    this.maxLife[i] = life;
    if (color) {
      this.colors[i * 3] = color.r;
      this.colors[i * 3 + 1] = color.g;
      this.colors[i * 3 + 2] = color.b;
    }
    this.sizes[i] = size;
  }

  update(dt, gravity = -9.8, drag = 0.6) {
    const p = this.positions;
    const v = this.velocities;
    let any = false;
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        p[i * 3 + 1] = -1000;
        this.sizes[i] = 0;
        continue;
      }
      v[i * 3 + 1] += gravity * dt;
      const k = Math.max(0, 1 - drag * dt);
      v[i * 3] *= k;
      v[i * 3 + 2] *= k;
      p[i * 3] += v[i * 3] * dt;
      p[i * 3 + 1] += v[i * 3 + 1] * dt;
      p[i * 3 + 2] += v[i * 3 + 2] * dt;
      if (p[i * 3 + 1] < 0.02) {
        p[i * 3 + 1] = 0.02;
        v[i * 3 + 1] *= -0.25;
      }
      // Fade by shrinking — avoids a per-particle alpha attribute.
      this.sizes[i] *= 1 - clamp(dt * 1.2, 0, 1);
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.size.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    return any;
  }
}

function particleMaterial(size, opacity, additive = false) {
  return new THREE.PointsMaterial({
    size,
    vertexColors: true,
    transparent: true,
    opacity,
    depthWrite: false,
    sizeAttenuation: true,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

export class Effects {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'effects';

    this.turf = new ParticlePool(240, particleMaterial(0.22, 0.9));
    this.confetti = new ParticlePool(420, particleMaterial(0.3, 1));
    this.sparks = new ParticlePool(120, particleMaterial(0.25, 0.9, true));

    this.group.add(this.turf.points);
    this.group.add(this.confetti.points);
    this.group.add(this.sparks.points);

    this._c = new THREE.Color();
    this.time = 0;

    // Ball speed trail.
    this.trailCount = 26;
    this.trailPositions = new Float32Array(this.trailCount * 3);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3));
    this.trail = new THREE.Line(
      trailGeo,
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.0, depthWrite: false })
    );
    this.trail.frustumCulled = false;
    this.trailIndex = 0;
    this.group.add(this.trail);
    for (let i = 0; i < this.trailCount; i++) this.trailPositions[i * 3 + 1] = -1000;
  }

  /** Turf kicked up by a slide tackle or a hard landing. */
  turfSpray(x, z, dirX, dirZ, amount = 14) {
    for (let i = 0; i < amount; i++) {
      const spread = (Math.random() - 0.5) * 2.2;
      const g = 0.28 + Math.random() * 0.35;
      this._c.setRGB(0.16 * g * 3, 0.4 * g * 2.2, 0.16 * g * 3);
      this.turf.spawn(
        x + (Math.random() - 0.5) * 0.5,
        0.06 + Math.random() * 0.1,
        z + (Math.random() - 0.5) * 0.5,
        dirX * (1.4 + Math.random() * 2.2) + spread,
        1.6 + Math.random() * 2.6,
        dirZ * (1.4 + Math.random() * 2.2) + spread,
        0.5 + Math.random() * 0.4,
        this._c,
        0.13 + Math.random() * 0.14
      );
    }
  }

  /** Bright flash particles for a post/crossbar strike. */
  impactSparks(x, y, z, amount = 12) {
    for (let i = 0; i < amount; i++) {
      this._c.setRGB(1, 0.92, 0.72);
      this.sparks.spawn(
        x,
        y,
        z,
        (Math.random() - 0.5) * 6,
        Math.random() * 4,
        (Math.random() - 0.5) * 6,
        0.32 + Math.random() * 0.22,
        this._c,
        0.16 + Math.random() * 0.16
      );
    }
  }

  /** Goal celebration confetti, tinted with the scoring team's colours. */
  goalConfetti(x, z, colorA, colorB) {
    const a = new THREE.Color(colorA);
    const b = new THREE.Color(colorB);
    for (let i = 0; i < this.confetti.count; i++) {
      const c = Math.random() < 0.5 ? a : b;
      this._c.copy(c).offsetHSL(0, 0, (Math.random() - 0.5) * 0.25);
      this.confetti.spawn(
        x + (Math.random() - 0.5) * 26,
        7 + Math.random() * 12,
        z + (Math.random() - 0.5) * 20,
        (Math.random() - 0.5) * 2.4,
        Math.random() * 1.5,
        (Math.random() - 0.5) * 2.4,
        2.6 + Math.random() * 2.4,
        this._c,
        0.16 + Math.random() * 0.2
      );
    }
  }

  /** Trail behind a struck ball; opacity tracks speed so slow balls have none. */
  updateTrail(ball) {
    const speed = ball.speed;
    const show = clamp((speed - 13) / 16, 0, 1);
    this.trail.material.opacity = show * 0.5;

    if (show <= 0.01) {
      // Collapse the trail onto the ball so it doesn't streak when it reappears.
      for (let i = 0; i < this.trailCount; i++) {
        this.trailPositions[i * 3] = ball.pos.x;
        this.trailPositions[i * 3 + 1] = ball.pos.y;
        this.trailPositions[i * 3 + 2] = ball.pos.z;
      }
    } else {
      // Shift the history back by one and append the current position.
      this.trailPositions.copyWithin(0, 3);
      const i = this.trailCount - 1;
      this.trailPositions[i * 3] = ball.pos.x;
      this.trailPositions[i * 3 + 1] = ball.pos.y;
      this.trailPositions[i * 3 + 2] = ball.pos.z;
    }
    this.trail.geometry.attributes.position.needsUpdate = true;
  }

  update(dt, ball) {
    this.time += dt;
    this.turf.update(dt, -11, 1.4);
    this.confetti.update(dt, -2.6, 0.55);
    this.sparks.update(dt, -6, 2.0);
    if (ball) this.updateTrail(ball);
  }
}
