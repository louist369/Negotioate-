import * as THREE from 'three';

/**
 * Image-based lighting.
 *
 * Every material in the scene is a MeshStandardMaterial, and a standard
 * material with no environment map has nothing to reflect: its specular
 * response collapses to a single directional highlight per light. That is what
 * makes an untextured Three.js scene read as plastic no matter how many
 * DirectionalLights are added to it — the problem is not brightness, it is that
 * the indirect term is a flat constant.
 *
 * So instead of adding more lights, we render a small procedural stadium
 * surround into a cube map and hand it to PMREMGenerator. Kits, boots, the
 * ball and the goal frames then pick up a bright sky above, warm floodlight
 * blooms at roof height, dark stands around the horizon and green bounce off
 * the turf below — which is exactly the light a real pitch sits in.
 *
 * Built once at startup and reused; the PMREM target is the only render-target
 * allocation here.
 */

/** Paint the surrounding luminance environment into an equirectangular canvas. */
function paintEnvironment(size = 512) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size / 2;
  const ctx = c.getContext('2d');
  const w = c.width;
  const h = c.height;

  // Vertical bands: sky -> roofline -> stands -> turf bounce. The horizon sits
  // at the vertical midpoint of an equirect map.
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0.0, '#0a1430'); // zenith, night sky
  sky.addColorStop(0.34, '#16233f');
  sky.addColorStop(0.46, '#2b3a55'); // haze above the roof
  sky.addColorStop(0.5, '#1a2033'); // roofline
  sky.addColorStop(0.62, '#12161f'); // stands in shadow
  sky.addColorStop(0.72, '#1b2a1c');
  sky.addColorStop(1.0, '#2c5c30'); // turf bounce from below
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // Floodlight banks. These are what actually shape the specular highlights on
  // a moving player — four bright sources sweeping across the kit as he turns.
  const flood = (cx, cy, r, peak) => {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(255,246,224,${peak})`);
    g.addColorStop(0.35, `rgba(255,232,188,${peak * 0.42})`);
    g.addColorStop(1, 'rgba(255,226,180,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  };

  const bankY = h * 0.44;
  for (let i = 0; i < 4; i++) {
    const cx = w * (0.125 + i * 0.25);
    flood(cx, bankY, w * 0.11, 1);
    // Wrapped copy so a bank near the seam still lights both sides.
    if (cx < w * 0.14) flood(cx + w, bankY, w * 0.11, 1);
    if (cx > w * 0.86) flood(cx - w, bankY, w * 0.11, 1);
  }

  // Crowd speckle in the stand band: thousands of small warm points, which
  // reads as a lit crowd rather than a grey wall in any reflection.
  ctx.globalAlpha = 0.5;
  for (let i = 0; i < 2600; i++) {
    const x = Math.random() * w;
    const y = h * (0.52 + Math.random() * 0.16);
    const v = 40 + Math.random() * 90;
    ctx.fillStyle = `rgb(${v},${v * 0.92},${v * 0.82})`;
    ctx.fillRect(x, y, 1.5, 1.5);
  }
  ctx.globalAlpha = 1;

  return c;
}

/**
 * Night sky for the visible background.
 *
 * A flat near-black clear colour is what makes an outdoor scene read as a
 * cut-out: real night sky above a floodlit stadium is never black, it is a
 * warm-tinted haze near the roofline fading to deep blue overhead, because the
 * floodlights light the air itself.
 */
export function makeSkyTexture(size = 1024) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size / 2;
  const ctx = c.getContext('2d');
  const w = c.width;
  const h = c.height;

  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0.0, '#04060f');
  g.addColorStop(0.3, '#070c1c');
  g.addColorStop(0.52, '#101a33');
  g.addColorStop(0.68, '#1d2a44'); // haze lit from below by the floodlights
  g.addColorStop(0.84, '#2a3550');
  g.addColorStop(1.0, '#151d2e');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // Stars, thinning out toward the horizon where the light pollution wins.
  for (let i = 0; i < 900; i++) {
    const y = Math.pow(Math.random(), 1.7) * h * 0.62;
    const x = Math.random() * w;
    const a = (1 - y / (h * 0.62)) * (0.25 + Math.random() * 0.6);
    const r = Math.random() < 0.08 ? 1.6 : 0.9;
    ctx.fillStyle = `rgba(214,226,255,${a.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Build the PMREM environment and attach it to the scene.
 * Returns a dispose function.
 */
export function applyEnvironment(scene, renderer, { intensity = 0.85 } = {}) {
  const canvas = paintEnvironment();
  const source = new THREE.CanvasTexture(canvas);
  source.mapping = THREE.EquirectangularReflectionMapping;
  source.colorSpace = THREE.SRGBColorSpace;
  source.needsUpdate = true;

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const target = pmrem.fromEquirectangular(source);

  scene.environment = target.texture;
  // Only the indirect term comes from the map — the sky itself is drawn by the
  // stadium geometry, so the background stays as authored.
  scene.environmentIntensity = intensity;

  source.dispose();
  pmrem.dispose();

  return () => {
    scene.environment = null;
    target.dispose();
  };
}
