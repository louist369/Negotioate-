import * as THREE from 'three';
import { PITCH, GRAPHICS, HALF_LENGTH, HALF_WIDTH, HALF_GOAL } from '../core/config.js';
import { makeGrassTexture, makeGrassBump, makeNetTexture, makeTurfMacro } from './textures.js';

/**
 * Pitch construction.
 *
 * Markings are real geometry rather than pixels in a texture: at broadcast
 * zoom a painted line on a 2k texture is a blurry 4px smear, whereas thin
 * coplanar quads stay crisp at any distance for a handful of triangles.
 */
export function buildPitch(renderer) {
  const group = new THREE.Group();
  group.name = 'pitch';

  const grass = makeGrassTexture(renderer);
  const bump = makeGrassBump(renderer);
  // One texture repeat per ~4 metres of turf.
  const rx = PITCH.length / 4;
  const rz = PITCH.width / 4;
  grass.repeat.set(rx, rz);
  bump.repeat.set(rx, rz);

  const fieldW = PITCH.length + PITCH.margin * 2;
  const fieldH = PITCH.width + PITCH.margin * 2;

  const turfMat = new THREE.MeshStandardMaterial({
    map: grass,
    bumpMap: bump,
    bumpScale: 0.35,
    roughness: 0.94,
    metalness: 0,
    color: 0xbfd8bf,
  });

  // Two-scale turf: the tiling `grass` map carries blade detail, and a single
  // pitch-sized macro map carries stripes, floodlight pooling and wear. Two
  // colour maps at different scales is not something MeshStandardMaterial
  // exposes, so the second is injected into the compiled shader.
  const macro = makeTurfMacro(renderer, {
    length: PITCH.length,
    width: PITCH.width,
    margin: PITCH.margin,
    stripes: GRAPHICS.grassStripeCount,
  });
  macro.wrapS = THREE.ClampToEdgeWrapping;
  macro.wrapT = THREE.ClampToEdgeWrapping;
  turfMat.userData.macro = { value: macro };
  turfMat.onBeforeCompile = (shader) => {
    shader.uniforms.uMacro = turfMat.userData.macro;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform sampler2D uMacro;
         varying vec2 vMacroUv;`
      )
      .replace(
        '#include <map_fragment>',
        `vec3 macro = texture2D(uMacro, vMacroUv).rgb;
         #include <map_fragment>
         // R: brightness. Centred on 0.5 so an untouched macro map is a no-op.
         diffuseColor.rgb *= 0.55 + macro.r * 0.9;`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
         // G: roughness. Stripes leaning away from the camera are glossier.
         roughnessFactor *= 0.62 + macro.g * 0.62;`
      );
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n varying vec2 vMacroUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n vMacroUv = uv;');
  };
  // Force a distinct program from any other MeshStandardMaterial in the scene.
  turfMat.customProgramCacheKey = () => 'pitchcraft-turf';

  const turf = new THREE.Mesh(new THREE.PlaneGeometry(fieldW, fieldH, 1, 1), turfMat);
  turf.rotation.x = -Math.PI / 2;
  turf.receiveShadow = true;
  turf.name = 'turf';
  group.add(turf);

  group.add(buildMarkings());

  group.add(buildCornerFlags());

  const goals = new THREE.Group();
  goals.name = 'goals';
  goals.add(buildGoal(renderer, 1));
  goals.add(buildGoal(renderer, -1));
  group.add(goals);

  return group;
}

/**
 * Corner flags.
 *
 * Four posts and four pennants — about eighty triangles in total, and the
 * cheapest single thing that makes a rendered pitch read as a football pitch
 * rather than a green rectangle with lines on it. Real broadcast framing almost
 * always has one in shot.
 */
function buildCornerFlags() {
  const g = new THREE.Group();
  g.name = 'cornerFlags';

  const postH = 1.5;
  const poleMat = new THREE.MeshStandardMaterial({ color: 0xf2f4f6, roughness: 0.5 });
  const flagMat = new THREE.MeshStandardMaterial({
    color: 0xffd23f,
    roughness: 0.75,
    side: THREE.DoubleSide,
    emissive: 0x3a2c00,
    emissiveIntensity: 0.4,
  });

  const pole = new THREE.CylinderGeometry(0.022, 0.026, postH, 6);
  pole.translate(0, postH / 2, 0);
  const pennant = new THREE.PlaneGeometry(0.34, 0.24);
  pennant.translate(0.17, 0, 0);

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * HALF_LENGTH;
      const z = sz * HALF_WIDTH;

      const p = new THREE.Mesh(pole, poleMat);
      p.position.set(x, 0, z);
      p.castShadow = true;
      g.add(p);

      const f = new THREE.Mesh(pennant, flagMat);
      f.position.set(x, postH - 0.17, z);
      // Point each pennant away from the pitch so none of them overhang play.
      f.rotation.y = Math.atan2(sx, sz) + Math.PI / 2;
      f.castShadow = true;
      g.add(f);
    }
  }
  return g;
}

/** Every painted line, merged conceptually into one group of thin quads. */
function buildMarkings() {
  const group = new THREE.Group();
  group.name = 'markings';
  const mat = new THREE.MeshBasicMaterial({
    color: 0xf2f6f2,
    transparent: true,
    opacity: 0.94,
    depthWrite: false,
  });
  const w = PITCH.lineWidth;
  const Y = 0.012;

  /** Axis-aligned line from (x1,z1) to (x2,z2). */
  const line = (x1, z1, x2, z2) => {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const horizontal = Math.abs(x2 - x1) >= Math.abs(z2 - z1);
    const geo = new THREE.PlaneGeometry(horizontal ? len : w, horizontal ? w : len);
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set((x1 + x2) / 2, Y, (z1 + z2) / 2);
    m.renderOrder = 2;
    group.add(m);
    return m;
  };

  const ring = (cx, cz, radius, thetaStart = 0, thetaLength = Math.PI * 2) => {
    const geo = new THREE.RingGeometry(radius - w / 2, radius + w / 2, 96, 1, thetaStart, thetaLength);
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(cx, Y, cz);
    m.renderOrder = 2;
    group.add(m);
    return m;
  };

  const dot = (cx, cz, radius = 0.13) => {
    const geo = new THREE.CircleGeometry(radius, 20);
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(cx, Y, cz);
    m.renderOrder = 2;
    group.add(m);
    return m;
  };

  // Touchlines and goal lines.
  line(-HALF_LENGTH, -HALF_WIDTH, HALF_LENGTH, -HALF_WIDTH);
  line(-HALF_LENGTH, HALF_WIDTH, HALF_LENGTH, HALF_WIDTH);
  line(-HALF_LENGTH, -HALF_WIDTH, -HALF_LENGTH, HALF_WIDTH);
  line(HALF_LENGTH, -HALF_WIDTH, HALF_LENGTH, HALF_WIDTH);

  // Halfway line, centre circle and spot.
  line(0, -HALF_WIDTH, 0, HALF_WIDTH);
  ring(0, 0, PITCH.centreCircleRadius);
  dot(0, 0);

  for (const side of [-1, 1]) {
    const gx = HALF_LENGTH * side;

    // Penalty area.
    const paX = gx - side * PITCH.penaltyAreaDepth;
    const paZ = PITCH.penaltyAreaWidth / 2;
    line(gx, -paZ, paX, -paZ);
    line(gx, paZ, paX, paZ);
    line(paX, -paZ, paX, paZ);

    // Six-yard box.
    const gaX = gx - side * PITCH.goalAreaDepth;
    const gaZ = PITCH.goalAreaWidth / 2;
    line(gx, -gaZ, gaX, -gaZ);
    line(gx, gaZ, gaX, gaZ);
    line(gaX, -gaZ, gaX, gaZ);

    // Penalty spot, and the arc where it pokes out beyond the penalty area.
    //
    // RingGeometry lives in the XY plane; after the -90deg X rotation a ring
    // angle t maps to world offset (cos t, -sin t) in (x, z). Solving
    // "which part of the circle lies further from goal than the box edge"
    // gives |cos t| >= inside/arcR, i.e. a sweep of 2*half centred on the
    // direction pointing away from the goal.
    const spotX = gx - side * PITCH.penaltySpot;
    dot(spotX, 0);
    const arcR = PITCH.centreCircleRadius * 0.82;
    const inside = Math.abs(paX - spotX);
    if (arcR > inside) {
      const half = Math.acos(Math.min(1, inside / arcR));
      const start = side > 0 ? Math.PI - half : -half;
      ring(spotX, 0, arcR, start, half * 2);
    }

    // Corner arcs: a quarter circle opening onto the pitch. Using the same
    // mapping, the interior quadrant for each corner is:
    //   (+x,+z) -> [pi/2, pi]   (+x,-z) -> [pi, 3pi/2]
    //   (-x,+z) -> [0, pi/2]    (-x,-z) -> [-pi/2, 0]
    for (const zside of [-1, 1]) {
      const cz = HALF_WIDTH * zside;
      const base =
        side > 0 ? (zside > 0 ? Math.PI / 2 : Math.PI) : zside > 0 ? 0 : -Math.PI / 2;
      ring(gx, cz, PITCH.cornerArcRadius, base, Math.PI / 2);
    }
  }

  return group;
}

/** Goal frame plus netting. */
function buildGoal(renderer, side) {
  const g = new THREE.Group();
  g.name = `goal${side > 0 ? 'Plus' : 'Minus'}`;

  const frameMat = new THREE.MeshStandardMaterial({
    color: 0xf4f6f8,
    roughness: 0.35,
    metalness: 0.15,
  });

  const r = PITCH.postRadius;
  const h = PITCH.goalHeight;
  const gx = HALF_LENGTH * side;

  const post = new THREE.CylinderGeometry(r, r, h, 14);
  for (const z of [-HALF_GOAL, HALF_GOAL]) {
    const m = new THREE.Mesh(post, frameMat);
    m.position.set(gx, h / 2, z);
    m.castShadow = true;
    g.add(m);
  }

  const bar = new THREE.CylinderGeometry(r, r, PITCH.goalWidth + r * 2, 14);
  const barMesh = new THREE.Mesh(bar, frameMat);
  barMesh.rotation.x = Math.PI / 2;
  barMesh.position.set(gx, h, 0);
  barMesh.castShadow = true;
  g.add(barMesh);

  // Rear support uprights.
  const backX = gx + side * PITCH.goalDepth;
  const backPost = new THREE.CylinderGeometry(r * 0.7, r * 0.7, h * 0.72, 10);
  for (const z of [-HALF_GOAL, HALF_GOAL]) {
    const m = new THREE.Mesh(backPost, frameMat);
    m.position.set(backX, h * 0.36, z);
    g.add(m);
  }

  // Netting.
  const netTex = makeNetTexture(renderer);
  const netMat = new THREE.MeshStandardMaterial({
    map: netTex,
    alphaMap: netTex,
    transparent: true,
    opacity: 0.92,
    side: THREE.DoubleSide,
    depthWrite: false,
    roughness: 1,
    color: 0xf2f6fb,
    // Nylon netting under floodlight is one of the brightest things on a pitch.
    // With the ambient fill cut back (see scene.js) the old 0.6 left it as a
    // grey smudge against the crowd behind it.
    emissive: 0x4a5c74,
    emissiveIntensity: 1.15,
  });

  const setRepeat = (mesh, uPerM, vPerM, w, hh) => {
    const m = netMat.clone();
    m.map = netTex.clone();
    m.map.wrapS = m.map.wrapT = THREE.RepeatWrapping;
    m.map.repeat.set(w * uPerM, hh * vPerM);
    m.map.needsUpdate = true;
    mesh.material = m;
  };

  // Texture repeats per metre. The net texture holds ~21 cells, so 0.45
  // repeats/m gives roughly 10cm mesh — fine enough to read as netting but
  // coarse enough to survive minification instead of aliasing into nothing.
  const density = 0.45;

  // Back of the net, angled slightly outward from the crossbar.
  const back = new THREE.Mesh(new THREE.PlaneGeometry(PITCH.goalWidth, h * 1.06), netMat);
  back.position.set(backX, h * 0.53, 0);
  back.rotation.y = side > 0 ? Math.PI : 0;
  setRepeat(back, density, density, PITCH.goalWidth, h);
  g.add(back);

  // Side panels.
  for (const z of [-HALF_GOAL, HALF_GOAL]) {
    const sideNet = new THREE.Mesh(new THREE.PlaneGeometry(PITCH.goalDepth, h), netMat);
    sideNet.position.set(gx + (side * PITCH.goalDepth) / 2, h / 2, z);
    sideNet.rotation.y = Math.PI / 2;
    setRepeat(sideNet, density, density, PITCH.goalDepth, h);
    g.add(sideNet);
  }

  // Roof of the net.
  const roof = new THREE.Mesh(new THREE.PlaneGeometry(PITCH.goalWidth, PITCH.goalDepth), netMat);
  roof.rotation.x = -Math.PI / 2;
  roof.position.set(gx + (side * PITCH.goalDepth) / 2, h, 0);
  setRepeat(roof, density, density, PITCH.goalWidth, PITCH.goalDepth);
  g.add(roof);

  return g;
}
