#!/usr/bin/env node
/**
 * Regenerate branding/svg, branding/png, and branding/app-tile.png
 * from the current mark spec (Cinzel Y + integrated wordmark).
 *
 * Requires: node 18+, rsvg-convert (librsvg), optional chromium for app-tile glow
 */

import { execSync } from "node:child_process";
import {
  cp,
  mkdir,
  readFile,
  writeFile,
  access,
} from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRANDING = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(BRANDING, "..");
const SVG_DIR = path.join(BRANDING, "svg");
const PNG_DIR = path.join(BRANDING, "png");
const FONTS_DIR = path.join(BRANDING, "fonts");
const SYNC_TARGETS = [
  path.join(REPO_ROOT, "docusaurus/static/img/branding"),
  path.join(REPO_ROOT, "landing/public/branding"),
  path.join(REPO_ROOT, "web/public/branding"),
];

const FAVICON_TARGETS = [
  {
    label: "web",
    appDir: path.join(REPO_ROOT, "web/app"),
    publicDir: path.join(REPO_ROOT, "web/public"),
  },
  {
    label: "landing",
    appDir: path.join(REPO_ROOT, "landing/app"),
    publicDir: path.join(REPO_ROOT, "landing/public"),
  },
  {
    label: "docusaurus",
    staticDir: path.join(REPO_ROOT, "docusaurus/static"),
  },
];

const COLORS = {
  niflheim: "#080B11",
  surface01: "#0E131B",
  surface02: "#151C26",
  rimeSoft: "#1F2937",
  frost: "#E8EEF4",
  shadow: "#5E6E7E",
  bifrost: "#2FD4C6",
  lightSurface: "#EEF3F7",
  lightTeal: "#0E7C73",
  lightText: "#0E131B",
  knockout: "#08110F",
};

const FONT_URLS = {
  cinzel:
    "https://fonts.gstatic.com/s/cinzel/v26/8vIU7ww63mVu7gtR-kwKxNvkNOjw-jHgTYo.ttf",
  spaceGrotesk:
    "https://fonts.gstatic.com/s/spacegrotesk/v22/V8mQoQDjQSkFtoMM3T6r8E7mF71Q-gOoraIAEj42Vksj.ttf",
};

async function fileExists(p) {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function ensureFonts() {
  await mkdir(FONTS_DIR, { recursive: true });
  for (const [name, url] of Object.entries(FONT_URLS)) {
    const dest = path.join(FONTS_DIR, `${name}.ttf`);
    if (!(await fileExists(dest))) {
      process.stdout.write(`Downloading ${name}…\n`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to download ${name}: ${res.status}`);
      await writeFile(dest, Buffer.from(await res.arrayBuffer()));
    }
  }
}

function fontDefs() {
  return `<defs>
  <style>
    @font-face {
      font-family: 'Cinzel';
      font-weight: 700;
      src: url('../fonts/cinzel.ttf') format('truetype');
    }
    @font-face {
      font-family: 'Space Grotesk';
      font-weight: 600;
      src: url('../fonts/spaceGrotesk.ttf') format('truetype');
    }
  </style>
</defs>`;
}

function card({ width, height, bg, border = COLORS.rimeSoft, content }) {
  const r = 16;
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="${width}" height="${height}" rx="${r}" fill="${bg}"/>
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="${r - 0.5}" stroke="${border}"/>
  ${content}
</svg>`;
}

function markY({
  cx,
  cy,
  size,
  fill,
  compact = false,
}) {
  const fontSize = compact ? size * 0.92 : size * 0.84;
  return `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-family="Cinzel, Georgia, serif" font-weight="700" font-size="${fontSize}" fill="${fill}">Y</text>`;
}

/** Integrated wordmark: Nordic Y is the first letter (oversized drop-cap). */
function wordmark({
  cx,
  cy,
  fontSize,
  yColor,
  ggColor,
  restColor,
}) {
  const ySize = Math.round(fontSize * 1.32);
  const kern = -(fontSize * 0.09).toFixed(2);
  // Tspans must be adjacent with no whitespace between tags — SVG preserves
  // inter-element whitespace as literal space characters.
  return `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-size="${fontSize}"><tspan font-family="Cinzel, Georgia, serif" font-weight="700" font-size="${ySize}" letter-spacing="-0.05em" fill="${yColor}">Y</tspan><tspan dx="${kern}" font-family="Space Grotesk, system-ui, sans-serif" font-weight="600" letter-spacing="-0.03em" fill="${ggColor}">gg</tspan><tspan font-family="Space Grotesk, system-ui, sans-serif" font-weight="600" letter-spacing="-0.03em" fill="${restColor}">drasil</tspan></text>`;
}

function bifrostGradient(id) {
  return `<defs>
  <linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="#1A8F88"/>
    <stop offset="55%" stop-color="#2FD4C6"/>
    <stop offset="100%" stop-color="#5BC0E8"/>
  </linearGradient>
</defs>`;
}

function buildAssets() {
  const defs = fontDefs();
  const H = 230;

  const primaryW = 280;
  const monoW = 269;
  const singleW = 280;
  const mutedW = 240;
  const wordmarkW = 420;
  const horizontalW = 520;
  const knockoutW = 480;
  const lightW = 480;

  return {
    "mark.svg": `<svg width="100" height="100" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">${defs}${markY({ cx: 50, cy: 50, size: 84, fill: COLORS.bifrost })}</svg>`,
    "mark-mono.svg": `<svg width="100" height="100" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">${defs}${markY({ cx: 50, cy: 50, size: 84, fill: COLORS.frost })}</svg>`,
    "primary.svg": card({
      width: primaryW,
      height: H,
      bg: COLORS.niflheim,
      content: `${defs}${markY({ cx: primaryW / 2, cy: H / 2, size: 150, fill: COLORS.bifrost })}`,
    }),
    "mono.svg": card({
      width: monoW,
      height: H,
      bg: COLORS.surface01,
      content: `${defs}${markY({ cx: monoW / 2, cy: H / 2, size: 110, fill: COLORS.frost })}`,
    }),
    "single.svg": card({
      width: singleW,
      height: H,
      bg: COLORS.niflheim,
      content: `${defs}${markY({ cx: singleW / 2, cy: H / 2, size: 108, fill: COLORS.bifrost })}`,
    }),
    "muted.svg": card({
      width: mutedW,
      height: H,
      bg: COLORS.niflheim,
      content: `${defs}${markY({ cx: mutedW / 2, cy: H / 2, size: 90, fill: COLORS.shadow, compact: true })}`,
    }),
    "stacked-lockup.svg": card({
      width: wordmarkW,
      height: H,
      bg: COLORS.surface02,
      content: `${defs}${wordmark({
        cx: wordmarkW / 2,
        cy: H / 2 + 6,
        fontSize: 32,
        yColor: COLORS.bifrost,
        ggColor: COLORS.bifrost,
        restColor: COLORS.frost,
      })}`,
    }),
    "horizontal-lockup.svg": card({
      width: horizontalW,
      height: H,
      bg: COLORS.surface01,
      content: `${defs}${wordmark({
        cx: horizontalW / 2,
        cy: H / 2 + 6,
        fontSize: 34,
        yColor: COLORS.bifrost,
        ggColor: COLORS.bifrost,
        restColor: COLORS.frost,
      })}`,
    }),
    "horizontal-knockout.svg": (() => {
      const gradId = "bifrost-bg";
      const r = 16;
      return `<svg width="${knockoutW}" height="${H}" viewBox="0 0 ${knockoutW} ${H}" fill="none" xmlns="http://www.w3.org/2000/svg">
  ${bifrostGradient(gradId)}
  ${defs}
  <rect width="${knockoutW}" height="${H}" rx="${r}" fill="url(#${gradId})"/>
  <rect x="0.5" y="0.5" width="${knockoutW - 1}" height="${H - 1}" rx="${r - 0.5}" stroke="${COLORS.rimeSoft}" stroke-opacity="0.35"/>
  ${wordmark({
    cx: knockoutW / 2,
    cy: H / 2 + 6,
    fontSize: 34,
    yColor: COLORS.knockout,
    ggColor: COLORS.knockout,
    restColor: COLORS.knockout,
  })}
</svg>`;
    })(),
    "light.svg": card({
      width: lightW,
      height: H,
      bg: COLORS.lightSurface,
      border: "#D5DEE6",
      content: `${defs}${wordmark({
        cx: lightW / 2,
        cy: H / 2 + 6,
        fontSize: 34,
        yColor: COLORS.lightTeal,
        ggColor: COLORS.lightTeal,
        restColor: COLORS.lightText,
      })}`,
    }),
    "app-tile.svg": (() => {
      const S = 512;
      const r = S * 0.22;
      return `<svg width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" fill="none" xmlns="http://www.w3.org/2000/svg">
  ${defs}
  <defs>
    <radialGradient id="tile-bg" cx="30%" cy="18%" r="120%">
      <stop offset="0%" stop-color="#16313a"/>
      <stop offset="60%" stop-color="#0c1118"/>
      <stop offset="100%" stop-color="${COLORS.niflheim}"/>
    </radialGradient>
    <radialGradient id="tile-glow" cx="50%" cy="120%" r="80%">
      <stop offset="0%" stop-color="rgba(47,212,198,0.22)"/>
      <stop offset="70%" stop-color="rgba(47,212,198,0)"/>
    </radialGradient>
  </defs>
  <rect width="${S}" height="${S}" rx="${r}" fill="url(#tile-bg)"/>
  <rect x="0.5" y="0.5" width="${S - 1}" height="${S - 1}" rx="${r - 0.5}" stroke="${COLORS.rimeSoft}"/>
  <rect width="${S}" height="${S}" rx="${r}" fill="url(#tile-glow)"/>
  ${markY({ cx: S / 2, cy: S / 2 + 8, size: 200, fill: COLORS.bifrost })}
</svg>`;
    })(),
  };
}

async function writeSvgs(assets) {
  await mkdir(SVG_DIR, { recursive: true });
  for (const [name, svg] of Object.entries(assets)) {
  if (name === "app-tile.svg") continue;
    await writeFile(path.join(SVG_DIR, name), svg);
    process.stdout.write(`  svg/${name}\n`);
  }
}

async function writePngs(assets) {
  await mkdir(PNG_DIR, { recursive: true });
  // rsvg-convert resolves relative font paths from the SVG file location.
  for (const [name, svg] of Object.entries(assets)) {
    if (name === "app-tile.svg") continue;
    const pngName = name.replace(".svg", ".png");
    const svgPath = path.join(SVG_DIR, name);
    const pngPath = path.join(PNG_DIR, pngName);
    const match = svg.match(/width="(\d+)"/);
    const width = match ? Number(match[1]) : 400;
    execSync(
      `rsvg-convert -w ${width * 2} "${svgPath}" -o "${pngPath}"`,
      { stdio: "pipe" },
    );
    process.stdout.write(`  png/${pngName}\n`);
  }
}

async function writeAppTile(appTileSvg) {
  const svgPath = path.join(BRANDING, ".app-tile-temp.svg");
  const pngPath = path.join(BRANDING, "app-tile.png");
  // Temp file lives in branding/ — point fonts at ./fonts/
  const tileSvg = appTileSvg
    .replaceAll("../fonts/", "./fonts/")
    .replaceAll("url('../fonts/", "url('./fonts/");
  await writeFile(svgPath, tileSvg);
  execSync(`rsvg-convert -w 512 "${svgPath}" -o "${pngPath}"`, {
    stdio: "pipe",
  });
  await import("node:fs/promises").then((fs) => fs.unlink(svgPath));
  process.stdout.write("  app-tile.png\n");
}

async function syncFavicons() {
  const tile = path.join(BRANDING, "app-tile.png");

  for (const target of FAVICON_TARGETS) {
    if (target.appDir) {
      await cp(tile, path.join(target.appDir, "icon.png"));
      await cp(tile, path.join(target.appDir, "apple-icon.png"));
      await cp(tile, path.join(target.publicDir, "favicon.png"));
      execSync(
        `convert "${tile}" -resize 32x32 "${path.join(target.publicDir, "favicon.ico")}"`,
        { stdio: "pipe" },
      );
      process.stdout.write(`  favicon → ${target.label}\n`);
      continue;
    }

    await cp(tile, path.join(target.staticDir, "favicon.png"));
    await cp(tile, path.join(target.staticDir, "img", "branding", "app-tile.png"));
    execSync(
      `convert "${tile}" -resize 32x32 "${path.join(target.staticDir, "favicon.ico")}"`,
      { stdio: "pipe" },
    );
    process.stdout.write(`  favicon → ${target.label}\n`);
  }
}

async function syncToConsumers() {
  for (const target of SYNC_TARGETS) {
    const svgDest = path.join(target, "svg");
    const pngDest = path.join(target, "png");
    const fontsDest = path.join(target, "fonts");
    await mkdir(svgDest, { recursive: true });
    await mkdir(pngDest, { recursive: true });
    await cp(SVG_DIR, svgDest, { recursive: true, force: true });
    await cp(PNG_DIR, pngDest, { recursive: true, force: true });
    await cp(FONTS_DIR, fontsDest, { recursive: true, force: true });
    await cp(path.join(BRANDING, "app-tile.png"), path.join(target, "app-tile.png"));
    process.stdout.write(`  synced → ${path.relative(REPO_ROOT, target)}\n`);
  }
}

async function main() {
  process.stdout.write("Generating Yggdrasil brand assets…\n");
  await ensureFonts();
  const assets = buildAssets();
  await writeSvgs(assets);
  process.stdout.write("Rasterising PNGs (2×)…\n");
  await writePngs(assets);
  process.stdout.write("App tile…\n");
  await writeAppTile(assets["app-tile.svg"]);
  process.stdout.write("Syncing to docs site and landing…\n");
  await syncToConsumers();
  process.stdout.write("Favicons…\n");
  await syncFavicons();
  process.stdout.write("Done.\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
