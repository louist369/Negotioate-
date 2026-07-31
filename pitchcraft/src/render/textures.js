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

/**
 * Pitch-scale "macro" map: one texel per ~7cm of turf, covering the whole field
 * exactly once. Sampled alongside the tiling blade texture (see pitch.js), it
 * carries everything that varies across the pitch rather than within a tile:
 *
 *   - mown stripes, as a tint AND a roughness shift. Real stripes are the same
 *     grass leaning toward or away from you; the light band is the one lying
 *     away, which is both brighter and glossier. Drawing them as a flat white
 *     overlay quad — which is what this replaces — gets the tint and misses the
 *     specular difference entirely, so they read as paint, not grass.
 *   - floodlight pooling, so the centre of the pitch is brighter than the
 *     corners and the turf stops being one uniform green.
 *   - wear: scuffed goalmouths, a worn centre circle, penalty spots.
 *
 * Red channel = brightness multiplier, green = roughness multiplier.
 */
export function makeTurfMacro(renderer, { length, width, margin, stripes }, size = 1024) {
  const aspect = (width + margin * 2) / (length + margin * 2);
  const w = size;
  const h = Math.round(size * aspect);
  const c = canvas(w, h);
  const ctx = c.getContext('2d');

  // Pitch (not field) bounds in pixels, for placing wear and stripes.
  const padX = (margin / (length + margin * 2)) * w;
  const padY = (margin / (width + margin * 2)) * h;
  const pw = w - padX * 2;
  const ph = h - padY * 2;

  ctx.fillStyle = 'rgb(128,128,0)';
  ctx.fillRect(0, 0, w, h);

  // --- mown stripes -------------------------------------------------------
  const bandW = pw / stripes;
  for (let i = 0; i < stripes; i++) {
    const away = i % 2 === 0;
    // Away-leaning bands are lighter and glossier; toward-leaning are darker
    // and duller. The asymmetry is deliberate — a real mow pattern is not a
    // symmetric ±x about the mean.
    const bright = away ? 150 : 108;
    const rough = away ? 108 : 148;
    ctx.fillStyle = `rgb(${bright},${rough},0)`;
    ctx.fillRect(padX + bandW * i, 0, Math.ceil(bandW) + 1, h);
  }
  // Run-off outside the touchlines is mown the same way but never played on.
  ctx.fillStyle = 'rgba(96,140,0,0.55)';
  ctx.fillRect(0, 0, padX, h);
  ctx.fillRect(w - padX, 0, padX, h);
  ctx.fillRect(0, 0, w, padY);
  ctx.fillRect(0, h - padY, w, padY);

  // --- floodlight pooling -------------------------------------------------
  // Four banks, one per corner, summed. Screen blending keeps the overlaps from
  // clipping to white.
  ctx.globalCompositeOperation = 'screen';
  for (const fx of [0.2, 0.8]) {
    for (const fy of [0.2, 0.8]) {
      const g = ctx.createRadialGradient(fx * w, fy * h, 0, fx * w, fy * h, w * 0.46);
      g.addColorStop(0, 'rgba(70,0,0,1)');
      g.addColorStop(0.55, 'rgba(34,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,1)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
  }
  ctx.globalCompositeOperation = 'source-over';

  // Corners fall away, which is what stops the field reading as a flat sheet.
  const vig = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, w * 0.62);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.28)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, w, h);

  // --- wear ---------------------------------------------------------------
  const wear = (cx, cy, rx, ry, amount) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, `rgba(190,170,0,${amount})`);
    g.addColorStop(1, 'rgba(190,170,0,0)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.fillRect(-rx, -rx, rx * 2, rx * 2);
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
  };

  // Goalmouths take by far the heaviest traffic on any pitch.
  wear(padX + pw * 0.045, padY + ph * 0.5, pw * 0.055, ph * 0.16, 0.34);
  wear(padX + pw * 0.955, padY + ph * 0.5, pw * 0.055, ph * 0.16, 0.34);
  // Penalty spots and the centre circle.
  wear(padX + pw * 0.115, padY + ph * 0.5, pw * 0.02, ph * 0.035, 0.4);
  wear(padX + pw * 0.885, padY + ph * 0.5, pw * 0.02, ph * 0.035, 0.4);
  wear(padX + pw * 0.5, padY + ph * 0.5, pw * 0.045, ph * 0.09, 0.22);
  // Scattered divots, so the wear does not read as four tidy airbrushed ovals.
  for (let i = 0; i < 90; i++) {
    const x = padX + Math.random() * pw;
    const y = padY + Math.random() * ph;
    // Concentrated toward the middle third, where the ball actually lives.
    const bias = 1 - Math.abs((x - padX) / pw - 0.5) * 1.2;
    wear(x, y, pw * (0.004 + Math.random() * 0.012), ph * 0.02, 0.12 * Math.max(bias, 0.2));
  }

  return finish(c, { renderer, srgb: false, aniso: 8 });
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
export function makeCrowdTexture(renderer, w = 1024, h = 512, palette = null) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');

  // Dark seating deck. Everything below is drawn *over* this, so the gaps
  // between spectators read as shadow between rows rather than as background.
  ctx.fillStyle = '#0d1015';
  ctx.fillRect(0, 0, w, h);

  // A real crowd is dark and desaturated at distance under floodlight. The
  // previous palette was fully-saturated primaries at equal weight, which is
  // why the stands read as television static: at 40m every spectator was as
  // loud as every other, so the eye found no structure to latch onto.
  //
  // Instead: a mostly muted mass, with team colours appearing in the minority
  // and true brights rarer still. That's what gives a stand texture.
  const muted = ['#3a3c42', '#2d3138', '#4a4136', '#53535a', '#38414d', '#463b3b', '#2a3630'];
  const team = palette || ['#28407a', '#8c3327', '#1e2a4a', '#6d2c22'];
  const bright = ['#c9c9c4', '#c8a63f', '#9ab4d8'];
  const pick = () => {
    const r = Math.random();
    if (r < 0.62) return muted[(Math.random() * muted.length) | 0];
    if (r < 0.9) return team[(Math.random() * team.length) | 0];
    return bright[(Math.random() * bright.length) | 0];
  };

  const cols = 78;
  const rows = 26;
  const cw = w / cols;
  const ch = h / rows;

  // Vertical aisles: real stands are split into blocks, and the gaps are what
  // stop a crowd texture from tiling as one undifferentiated sheet.
  const aisles = new Set();
  for (let i = 6; i < cols; i += 13) aisles.add(i);

  for (let r = 0; r < rows; r++) {
    // Seat rows step back, so each row is drawn on a slightly darker band.
    const rowShade = 0.72 + (r / rows) * 0.42;
    ctx.fillStyle = `rgba(0,0,0,${(0.3 - (r / rows) * 0.22).toFixed(3)})`;
    ctx.fillRect(0, r * ch, w, ch);

    for (let i = 0; i < cols; i++) {
      if (aisles.has(i)) continue;
      // Empty seats cluster rather than scatter — one gap is rarely alone.
      if (Math.random() < 0.1) continue;

      const x = i * cw + cw * 0.5 + (Math.random() - 0.5) * cw * 0.3;
      const y = r * ch + ch * 0.78;
      const col = pick();

      // Body: shoulders wider than the waist, so a spectator is not a domino.
      ctx.fillStyle = col;
      ctx.globalAlpha = rowShade;
      const bw = cw * 0.66;
      const bh = ch * 0.5;
      ctx.beginPath();
      ctx.moveTo(x - bw / 2, y);
      ctx.lineTo(x - bw * 0.42, y - bh);
      ctx.lineTo(x + bw * 0.42, y - bh);
      ctx.lineTo(x + bw / 2, y);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = ['#c9a281', '#a8794f', '#7a5030', '#4e3320', '#2f2018'][
        (Math.random() * 5) | 0
      ];
      ctx.beginPath();
      ctx.arc(x, y - bh - ch * 0.13, Math.min(cw, ch) * 0.19, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // A scatter of phone screens and lit faces — the only genuinely bright pixels
  // in the stand, and the thing that sells it as a night crowd once bloom
  // catches them.
  for (let i = 0; i < 130; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    ctx.fillStyle = `rgba(190,214,255,${0.35 + Math.random() * 0.4})`;
    ctx.fillRect(x, y, cw * 0.28, ch * 0.18);
  }

  noiseOverlay(ctx, w, h, 16);
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

/**
 * Shirt fabric. Wrapped cylindrically around the torso, so U runs around the
 * chest (0 = front centre) and V runs from hem to shoulder.
 *
 * A footballer in a single flat colour is the cheapest thing to render and the
 * most obviously wrong: real kits have a sleeve break, a collar, a hem band and
 * a knit that catches light. All four are drawn here rather than modelled, so
 * they cost one shared texture per team instead of extra geometry per player.
 */
export function makeShirtTexture(renderer, colors, { keeper = false, size = 256 } = {}) {
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const base = keeper ? colors.keeper : colors.primary;
  const trim = keeper ? '#f2f2f2' : colors.accent;
  const dark = keeper ? colors.keeperShorts : colors.secondary;

  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  if (!keeper) {
    // Two body stripes, offset from centre so the front reads asymmetrically —
    // symmetric stripes look like a test pattern from the broadcast camera.
    ctx.fillStyle = dark;
    ctx.globalAlpha = 0.55;
    for (const u of [0.13, 0.31, 0.69, 0.87]) {
      ctx.fillRect(Math.round(u * size), 0, Math.max(2, size * 0.035), size);
    }
    ctx.globalAlpha = 1;
  }

  // Shoulder yoke and collar: the top ~12% of V.
  ctx.fillStyle = dark;
  ctx.fillRect(0, 0, size, size * 0.07);
  ctx.fillStyle = trim;
  ctx.fillRect(0, size * 0.07, size, size * 0.022);

  // Hem band at the bottom of the shirt.
  ctx.fillStyle = trim;
  ctx.fillRect(0, size * 0.955, size, size * 0.045);

  // Knit: fine horizontal weave plus noise. Subtle, but it stops the chest
  // reading as a flat plastic panel under a specular highlight.
  ctx.globalAlpha = 0.05;
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  for (let y = 0; y < size; y += 3) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(size, y + 0.5);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  noiseOverlay(ctx, size, size, 12);

  return finish(c, { renderer, aniso: 4 });
}

/**
 * Roughness map for kit fabric: polyester is glossy where it is stretched over
 * the chest and duller in the folds. Non-colour data, so no sRGB conversion.
 */
export function makeFabricRoughness(renderer, size = 128) {
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#8a8a8a';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 2 + Math.random() * 9;
    const v = Math.random() < 0.5 ? 130 : 190;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${v},${v},${v},0.5)`);
    g.addColorStop(1, `rgba(${v},${v},${v},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return finish(c, { renderer, srgb: false, aniso: 2 });
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
