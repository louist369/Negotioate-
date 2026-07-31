import * as THREE from 'three';

/**
 * All textures are generated procedurally at runtime. Nothing is loaded from
 * disk, so the build has no asset pipeline and no third-party art in it.
 */

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function finish(c, { repeat = null, aniso = 8, srgb = true, renderer = null } = {}) {
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  if (repeat) tex.repeat.set(repeat[0], repeat[1]);
  tex.anisotropy = renderer ? Math.min(aniso, renderer.capabilities.getMaxAnisotropy()) : aniso;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Simple value noise, used to break up flat surfaces. */
function noiseOverlay(ctx, w, h, amount, scale = 1) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amount;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * Turf: a tileable patch of grass blades. The mown stripes are applied as
 * separate geometry so the tiling stays seamless at any pitch size.
 */
export function makeGrassTexture(renderer, size = 512) {
  const c = canvas(size, size);
  const ctx = c.getContext('2d');

  ctx.fillStyle = '#2f7a34';
  ctx.fillRect(0, 0, size, size);

  // Blade clusters.
  for (let i = 0; i < 9000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const len = 3 + Math.random() * 7;
    const lean = (Math.random() - 0.5) * 3;
    const shade = 0.72 + Math.random() * 0.55;
    const r = Math.floor(44 * shade);
    const g = Math.floor(128 * shade);
    const b = Math.floor(50 * shade);
    ctx.strokeStyle = `rgb(${r},${g},${b})`;
    ctx.lineWidth = 0.9 + Math.random() * 0.9;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + lean, y - len);
    ctx.stroke();
  }

  noiseOverlay(ctx, size, size, 14);
  return finish(c, { repeat: [1, 1], aniso: 16, renderer });
}

/** Matching roughness/bump map so the turf catches floodlight properly. */
export function makeGrassBump(renderer, size = 512) {
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 7000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const v = Math.floor(90 + Math.random() * 110);
    ctx.strokeStyle = `rgb(${v},${v},${v})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (Math.random() - 0.5) * 3, y - 3 - Math.random() * 5);
    ctx.stroke();
  }
  return finish(c, { repeat: [1, 1], srgb: false, renderer });
}

/** Goal netting: a transparent grid with slight sag baked into the line weight. */
export function makeNetTexture(renderer, size = 256, cell = 12) {
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  for (let i = 0; i <= size; i += cell) {
    ctx.moveTo(i + 0.5, 0);
    ctx.lineTo(i + 0.5, size);
    ctx.moveTo(0, i + 0.5);
    ctx.lineTo(size, i + 0.5);
  }
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 8;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Crowd sheet: rows of abstract spectators used on the stand instancing.
 * Deliberately loose — at broadcast distance this reads as a packed stadium.
 */
export function makeCrowdTexture(renderer, w = 512, h = 256, palette = null) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#12161d';
  ctx.fillRect(0, 0, w, h);

  const colors = palette || ['#d8d8d8', '#2b4a8c', '#b7362a', '#e8c65a', '#3d3d45', '#6f4f8f', '#2f7f6a'];
  const cols = 46;
  const rows = 18;
  const cw = w / cols;
  const ch = h / rows;

  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < cols; i++) {
      if (Math.random() < 0.06) continue; // a few empty seats
      const x = i * cw + cw * 0.5 + (Math.random() - 0.5) * cw * 0.35;
      const y = r * ch + ch * 0.62;
      const col = colors[(Math.random() * colors.length) | 0];
      // Body.
      ctx.fillStyle = col;
      const bw = cw * 0.62;
      const bh = ch * 0.55;
      ctx.fillRect(x - bw / 2, y - bh, bw, bh);
      // Head.
      ctx.fillStyle = ['#f0c49a', '#c08b5c', '#8a5a30', '#5a3418'][(Math.random() * 4) | 0];
      ctx.beginPath();
      ctx.arc(x, y - bh - ch * 0.16, Math.min(cw, ch) * 0.17, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  noiseOverlay(ctx, w, h, 22);
  return finish(c, { repeat: [1, 1], aniso: 4, renderer });
}

/** Perimeter LED board with the game's own wordmark. */
export function makeAdBoardTexture(renderer, text = 'PITCHCRAFT', w = 1024, h = 128) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const grd = ctx.createLinearGradient(0, 0, w, 0);
  grd.addColorStop(0, '#0b1524');
  grd.addColorStop(0.5, '#12233d');
  grd.addColorStop(1, '#0b1524');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, w, h);

  // One wordmark per canvas, scaled to fit with margin. Packing several copies
  // into the canvas clips them at the cell edges and the tiled result reads as
  // garbled text once the texture repeats along the boards.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let fontSize = h * 0.52;
  ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
  const maxWidth = w * 0.78;
  const measured = ctx.measureText(text).width;
  if (measured > maxWidth) {
    fontSize *= maxWidth / measured;
    ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, w * 0.5, h * 0.5);

  // Accent ticks at the tile seams so the repeat reads as separate boards.
  ctx.fillStyle = '#4fd1ff';
  ctx.fillRect(0, 0, 5, h);
  ctx.fillRect(w - 5, 0, 5, h);
  // Scanline sheen.
  ctx.fillStyle = 'rgba(255,255,255,0.045)';
  for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 1);
  return finish(c, { repeat: [1, 1], aniso: 8, renderer });
}

/** Shirt number, applied to the back of a kit. */
export function makeNumberTexture(number, fg = '#ffffff', bg = null, size = 128) {
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  if (bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size, size);
  } else {
    ctx.clearRect(0, 0, size, size);
  }
  ctx.font = `bold ${size * 0.62}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = fg;
  ctx.fillText(String(number), size / 2, size * 0.54);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Football panel pattern — classic truncated-icosahedron look, drawn abstractly. */
export function makeBallTexture(renderer, size = 512) {
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f6f6f2';
  ctx.fillRect(0, 0, size, size);

  // Pentagon-ish dark patches laid out in a staggered grid; wraps well enough
  // on a sphere at gameplay distance.
  const drawPoly = (cx, cy, r, n, rot, fill) => {
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * Math.PI * 2;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };

  const cols = 4;
  const rows = 3;
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < cols; i++) {
      const cx = ((i + (r % 2 ? 0.5 : 0)) / cols) * size;
      const cy = ((r + 0.5) / rows) * size;
      drawPoly(cx, cy, size * 0.075, 5, r * 0.4 + i * 0.3, '#1c1c22');
    }
  }

  noiseOverlay(ctx, size, size, 8);
  return finish(c, { repeat: [1, 1], aniso: 8, renderer });
}

/** Soft radial blob used for contact shadows and light glows. */
export function makeRadialTexture(inner = 'rgba(0,0,0,0.55)', outer = 'rgba(0,0,0,0)', size = 128) {
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}
