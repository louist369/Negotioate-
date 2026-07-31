import * as THREE from 'three';
import { PITCH, GRAPHICS, HALF_LENGTH, HALF_WIDTH } from '../core/config.js';
import { makeCrowdTexture, makeAdBoardTexture, makeRadialTexture } from './textures.js';
import { mergeGeometries } from './geometryUtils.js';

/**
 * Stadium shell.
 *
 * The crowd is the interesting problem: tens of thousands of spectators has to
 * cost almost nothing. Two techniques are combined —
 *   1. a textured, raked plane per stand carries the bulk of the crowd, and
 *   2. a single InstancedMesh scatters a few thousand actual 3D figures over
 *      the front rows, where the flat texture would otherwise read as wallpaper.
 * The instanced figures bob on a per-instance phase so the crowd is alive.
 */
export function buildStadium(renderer, crowdDensity = GRAPHICS.crowdDensity) {
  const group = new THREE.Group();
  group.name = 'stadium';

  const outerX = HALF_LENGTH + PITCH.margin;
  const outerZ = HALF_WIDTH + PITCH.margin;

  group.add(buildSurround(outerX, outerZ));
  group.add(buildAdBoards(renderer, outerX, outerZ));

  const stands = buildStands(renderer, outerX, outerZ);
  group.add(stands.group);

  const crowd = buildInstancedCrowd(stands.rows, crowdDensity);
  group.add(crowd.mesh);

  group.add(buildFloodlights(outerX, outerZ));

  return { group, crowd };
}

/** The flat apron between the touchline and the stands. */
function buildSurround(outerX, outerZ) {
  const g = new THREE.Group();
  g.name = 'surround';
  const mat = new THREE.MeshStandardMaterial({ color: 0x1d2a20, roughness: 1 });
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(outerX * 2 + 12, outerZ * 2 + 12), mat);
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = -0.02;
  apron.receiveShadow = true;
  g.add(apron);
  return g;
}

function buildAdBoards(renderer, outerX, outerZ) {
  const g = new THREE.Group();
  g.name = 'adBoards';
  const tex = makeAdBoardTexture(renderer);
  const height = 0.95;
  const inset = 2.6;

  const make = (w, x, z, rotY, repeats) => {
    const m = tex.clone();
    m.wrapS = m.wrapT = THREE.RepeatWrapping;
    m.repeat.set(repeats, 1);
    m.needsUpdate = true;
    const mat = new THREE.MeshStandardMaterial({
      map: m,
      emissive: 0x1a3350,
      emissiveMap: m,
      emissiveIntensity: 0.75,
      roughness: 0.6,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, height), mat);
    mesh.position.set(x, height / 2, z);
    mesh.rotation.y = rotY;
    g.add(mesh);
  };

  // One board per ~9m of perimeter, rounded so the texture tiles without
  // slicing the wordmark.
  const lenX = HALF_LENGTH * 2;
  const lenZ = HALF_WIDTH * 2;
  const repsX = Math.max(1, Math.round(lenX / 9));
  const repsZ = Math.max(1, Math.round(lenZ / 9));
  make(lenX, 0, -(HALF_WIDTH + inset), 0, repsX);
  make(lenX, 0, HALF_WIDTH + inset, Math.PI, repsX);
  make(lenZ, -(HALF_LENGTH + inset), 0, Math.PI / 2, repsZ);
  make(lenZ, HALF_LENGTH + inset, 0, -Math.PI / 2, repsZ);

  return g;
}

/**
 * Four raked stands. Each is a sloped plane carrying the crowd texture, plus a
 * solid back wall and a roof. Returns the row geometry so the instanced crowd
 * can be scattered on the same surfaces.
 */
function buildStands(renderer, outerX, outerZ) {
  const group = new THREE.Group();
  group.name = 'stands';

  const crowdTex = makeCrowdTexture(renderer);
  const concrete = new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.9 });
  const roofMat = new THREE.MeshStandardMaterial({
    color: 0x171b22,
    roughness: 0.7,
    metalness: 0.25,
    side: THREE.DoubleSide,
  });

  const rows = [];
  const depth = 22;
  const rise = 15;

  /**
   * Build one stand.
   *
   * Convention: every stand is modelled in local space with **+Z pointing away
   * from the pitch**, so the seating rises from the origin (pitch-side, ground
   * level) back and up. `rotY` is therefore chosen so that local +Z maps to the
   * outward world direction for that side.
   *
   * @param {number} length  span of the stand
   * @param {THREE.Vector3} origin  bottom-front-centre, at the pitch-side edge
   * @param {number} rotY  rotation mapping local +Z to "away from the pitch"
   */
  const stand = (length, origin, rotY, repeats) => {
    const s = new THREE.Group();
    s.position.copy(origin);
    s.rotation.y = rotY;

    const slope = Math.atan2(rise, depth);
    const deckLen = Math.hypot(rise, depth);

    const tex = crowdTex.clone();
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeats, 2.1);
    tex.needsUpdate = true;
    const deckMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1, side: THREE.DoubleSide });

    // Raked deck. A plane's normal is +Z; rotating by (-pi/2 - slope) about X
    // sends it to (0, cos s, -sin s) — up and tilted back toward the pitch,
    // which is exactly where the camera watches from.
    const deck = new THREE.Mesh(new THREE.PlaneGeometry(length, deckLen), deckMat);
    deck.rotation.x = -Math.PI / 2 - slope;
    deck.position.set(0, rise / 2, depth / 2);
    s.add(deck);

    // The roof must clear the broadcast camera, which flies inside the near
    // stand's volume — otherwise the leading fascia slices across the shot.
    const roofY = rise + 11;

    // Back wall, facing the pitch.
    const back = new THREE.Mesh(new THREE.PlaneGeometry(length, roofY), concrete);
    back.position.set(0, roofY / 2, depth);
    back.rotation.y = Math.PI;
    s.add(back);

    // Roof over the seating.
    const roof = new THREE.Mesh(new THREE.PlaneGeometry(length, depth + 3), roofMat);
    roof.rotation.x = -Math.PI / 2;
    roof.position.set(0, roofY, depth / 2 - 1.5);
    s.add(roof);

    // Fascia along the roof's leading edge so the stand reads as a solid volume.
    const fascia = new THREE.Mesh(new THREE.PlaneGeometry(length, 2.2), roofMat);
    fascia.position.set(0, roofY - 1.1, -1.5);
    s.add(fascia);

    group.add(s);

    rows.push({ origin: origin.clone(), rotY, length, depth, rise });
    return s;
  };

  const sideLen = HALF_LENGTH * 2 + 14;
  const endLen = HALF_WIDTH * 2 + 10;

  // rotY maps local +Z onto the outward direction for each side.
  stand(sideLen, new THREE.Vector3(0, 0, outerZ), 0, 11);
  stand(sideLen, new THREE.Vector3(0, 0, -outerZ), Math.PI, 11);
  stand(endLen, new THREE.Vector3(outerX, 0, 0), Math.PI / 2, 7);
  stand(endLen, new THREE.Vector3(-outerX, 0, 0), -Math.PI / 2, 7);

  return { group, rows };
}

/**
 * A few thousand real spectator figures on the front rows of every stand,
 * drawn in a single InstancedMesh. Each carries a random colour and a bob
 * phase packed into the instance colour's unused channel budget.
 */
function buildInstancedCrowd(rows, density = GRAPHICS.crowdDensity) {
  // One tiny figure: body + head merged into a single geometry. Kept extremely
  // cheap — this geometry is multiplied by a couple of thousand instances.
  const body = new THREE.CylinderGeometry(0.17, 0.21, 0.62, 5, 1, true);
  body.translate(0, 0.31, 0);
  const head = new THREE.SphereGeometry(0.14, 5, 3);
  head.translate(0, 0.76, 0);

  const geo = mergeGeometries([body, head]);

  const perStand = Math.max(40, Math.floor(560 * density));
  const total = perStand * rows.length;

  // NOTE: do not set `vertexColors` here. InstancedMesh tints via `instanceColor`,
  // which three.js applies on its own; enabling vertexColors makes the shader
  // look for a per-vertex `color` attribute that this geometry does not have,
  // and every spectator renders black.
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const mesh = new THREE.InstancedMesh(geo, mat, total);
  mesh.name = 'crowdFigures';
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;

  const palette = [
    new THREE.Color('#e6e6e6'),
    new THREE.Color('#2b4a8c'),
    new THREE.Color('#b7362a'),
    new THREE.Color('#e8c65a'),
    new THREE.Color('#3d3d45'),
    new THREE.Color('#6f4f8f'),
    new THREE.Color('#2f7f6a'),
    new THREE.Color('#c96a2b'),
  ];

  const dummy = new THREE.Object3D();
  const phases = new Float32Array(total);
  const bases = new Float32Array(total * 3);

  let i = 0;
  for (const row of rows) {
    // Local +Z is "away from the pitch" (see buildStands), so the seating rows
    // march outward along this vector.
    const fwd = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), row.rotY);
    const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), row.rotY);

    for (let n = 0; n < perStand; n++) {
      // Only populate the front third of the deck — beyond that the texture wins.
      const t = Math.pow(Math.random(), 1.7) * 0.42;
      const along = (Math.random() - 0.5) * row.length * 0.97;
      const depthIn = t * row.depth;
      const height = t * row.rise;

      const x = row.origin.x + right.x * along + fwd.x * depthIn;
      const z = row.origin.z + right.z * along + fwd.z * depthIn;
      const y = height + 0.35;

      bases[i * 3] = x;
      bases[i * 3 + 1] = y;
      bases[i * 3 + 2] = z;
      phases[i] = Math.random() * Math.PI * 2;

      dummy.position.set(x, y, z);
      // Spectators face back toward the pitch.
      dummy.rotation.set(0, row.rotY + Math.PI + (Math.random() - 0.5) * 0.5, 0);
      const s = 0.92 + Math.random() * 0.22;
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, palette[(Math.random() * palette.length) | 0]);
      i++;
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  return {
    mesh,
    phases,
    bases,
    count: total,
    dummy,
    /**
     * Animate the crowd. `excitement` 0..1 scales the bob; a goal pushes it to 1
     * and it decays, so the stands visibly erupt.
     */
    update(time, excitement) {
      const amp = 0.05 + excitement * 0.55;
      for (let k = 0; k < total; k++) {
        const p = phases[k];
        const bob = Math.sin(time * (2.2 + excitement * 5) + p) * amp;
        const bx = bases[k * 3];
        const by = bases[k * 3 + 1];
        const bz = bases[k * 3 + 2];
        dummy.position.set(bx, by + Math.max(0, bob), bz);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        mesh.setMatrixAt(k, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

/** Corner floodlight pylons with glowing heads. */
function buildFloodlights(outerX, outerZ) {
  const g = new THREE.Group();
  g.name = 'floodlights';

  const mastMat = new THREE.MeshStandardMaterial({ color: 0x20252d, roughness: 0.6, metalness: 0.4 });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff6e0 });
  const glowTex = makeRadialTexture('rgba(255,246,224,0.55)', 'rgba(255,246,224,0)');

  const H = 34;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * (outerX + 6);
      const z = sz * (outerZ + 6);

      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.72, H, 10), mastMat);
      mast.position.set(x, H / 2, z);
      g.add(mast);

      const rig = new THREE.Group();
      rig.position.set(x, H, z);
      rig.lookAt(0, 0, 0);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(6.5, 3.4, 0.4), mastMat);
      rig.add(frame);

      for (let r = 0; r < 2; r++) {
        for (let c = 0; c < 4; c++) {
          const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.3, 0.25), lampMat);
          lamp.position.set(-2.4 + c * 1.6, -0.8 + r * 1.6, 0.3);
          rig.add(lamp);
        }
      }

      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
      );
      glow.scale.set(26, 26, 1);
      glow.position.set(x, H, z);
      g.add(glow);

      g.add(rig);
    }
  }

  return g;
}
