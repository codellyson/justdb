import { createRequire } from 'node:module';
// Use Astro's installed image-processing dependency.
const require = createRequire(import.meta.url);
const sharp = createRequire(require.resolve('astro/package.json'))('sharp');
import { readFile, writeFile } from 'node:fs/promises';

const publicDir = new URL('../public/', import.meta.url);
const logo = (await readFile(new URL('logo.svg', publicDir))).toString('base64');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#111111"/>
  <rect x="24" y="24" width="1152" height="582" rx="20" fill="none" stroke="#303030"/>
  <image href="data:image/svg+xml;base64,${logo}" x="68" y="66" width="56" height="56"/>
  <g font-family="Helvetica, Arial, sans-serif">
    <text x="140" y="106" fill="#fafafa" font-size="36" font-weight="700">JustDB</text>
    <text x="72" y="270" fill="#fafafa" font-size="88" font-weight="700" letter-spacing="-3">Just your data.</text>
    <text x="72" y="370" fill="#a3a3a3" font-size="88" font-weight="700" letter-spacing="-3">No bullshit.</text>
    <text x="76" y="435" fill="#c4c4c4" font-size="27">Browse. Query. Edit. Right from your desktop.</text>
    <path d="M76 486H1124" stroke="#333333"/>
    <text x="76" y="545" fill="#fafafa" font-size="24">PostgreSQL · SQLite · Turso</text>
    <text x="1124" y="545" text-anchor="end" fill="#a3a3a3" font-size="23">Free. Local-first. No signup.</text>
  </g>
</svg>`;
await writeFile(new URL('og-justdb-v2.svg', publicDir), svg);
await sharp(Buffer.from(svg)).png().toFile(new URL('og-justdb-v2.png', publicDir).pathname);
