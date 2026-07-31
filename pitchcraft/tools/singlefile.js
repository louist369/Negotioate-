/**
 * Build a single self-contained HTML file.
 *
 * Inlines the CSS and the JS bundle into one document with no external
 * references of any kind. Everything the game needs is already generated at
 * runtime — no images, fonts or audio files — so the result is genuinely
 * standalone and can be opened from anywhere, including a host that forbids
 * outbound requests.
 *
 * Emits body-content only (no doctype/html/head/body wrapper) so it can be
 * dropped straight into a host page.
 *
 *   node tools/singlefile.js [outfile]
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const OUT = process.argv[2] || path.join(ROOT, 'dist-single', 'pitchcraft.html');

if (!existsSync(DIST)) {
  console.error('dist/ not found — run `npm run build` first.');
  process.exit(1);
}

const assets = path.join(DIST, 'assets');
const files = readdirSync(assets);
const jsFile = files.find((f) => f.endsWith('.js'));
const cssFile = files.find((f) => f.endsWith('.css'));

if (!jsFile) {
  console.error('no JS bundle found in dist/assets');
  process.exit(1);
}

const js = readFileSync(path.join(assets, jsFile), 'utf8');
const css = cssFile ? readFileSync(path.join(assets, cssFile), 'utf8') : '';

// Pull the markup out of the built index.html, minus the script/link tags we
// are replacing with inline content.
const indexHtml = readFileSync(path.join(DIST, 'index.html'), 'utf8');
const bodyMatch = indexHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
let body = bodyMatch ? bodyMatch[1] : '';
body = body
  .replace(/<script[^>]*src=[^>]*><\/script>/gi, '')
  .replace(/<link[^>]*rel=["']stylesheet["'][^>]*>/gi, '')
  .trim();

// `</script>` anywhere inside the bundle would terminate the inline script tag.
const safeJs = js.replace(/<\/script>/gi, '<\\/script>');

const out = `<style>
${css}
</style>

${body}

<script type="module">
${safeJs}
</script>
`;

mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, out, 'utf8');

const kb = (n) => `${(n / 1024).toFixed(0)} kB`;
console.log(`wrote ${OUT}`);
console.log(`  css    ${kb(css.length)}`);
console.log(`  js     ${kb(js.length)}`);
console.log(`  total  ${kb(statSync(OUT).size)}`);

// Fail loudly if anything still points outside the document.
const external = [...out.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)]
  .map((m) => m[1])
  .filter((u) => !u.startsWith('data:') && !u.startsWith('#'));
if (external.length) {
  console.error('\nexternal references remain:', external);
  process.exit(1);
}
console.log('  no external references — fully self-contained');
