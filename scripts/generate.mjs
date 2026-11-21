#!/usr/bin/env node
// Contribution Space Shooter — genera un SVG animado donde una nave (o un tanque)
// destruye tu gráfica de contribuciones de GitHub. Sin dependencias.
//
// Uso:
//   GITHUB_TOKEN=xxx node scripts/generate.mjs --user <login> --out dist
//   node scripts/generate.mjs --demo --out dist          (datos falsos para probar)
// Opciones:
//   --style ship|tank   (por defecto ship)

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ---------- CLI ----------
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) {
      const next = arr[i + 1];
      acc.push([a.slice(2), next && !next.startsWith("--") ? next : true]);
    }
    return acc;
  }, [])
);
const USER = args.user || process.env.GITHUB_USER;
const OUT = args.out || "dist";
const STYLE = (args.style || process.env.STYLE || "ship").toLowerCase();
const DEMO = !!args.demo;

// ---------- Datos ----------
const LEVELS = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };

async function fetchGrid(user) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("Falta GITHUB_TOKEN");
  const query = `query($login:String!){user(login:$login){contributionsCollection{contributionCalendar{weeks{contributionDays{weekday contributionLevel}}}}}}`;
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json", "User-Agent": "space-shooter" },
    body: JSON.stringify({ query, variables: { login: user } }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  const weeks = json.data.user.contributionsCollection.contributionCalendar.weeks;
  return weeks.map((w) => {
    const col = Array(7).fill(null);
    for (const d of w.contributionDays) col[d.weekday] = LEVELS[d.contributionLevel] ?? 0;
    return col;
  });
}

function demoGrid() {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: 53 }, (_, c) =>
    Array.from({ length: 7 }, (_, r) => {
      if (c === 52 && r > 3) return null; // semana actual incompleta
      const x = rnd() * (0.6 + 0.4 * Math.sin(c / 6));
      return x < 0.35 ? 0 : Math.min(4, Math.ceil((x - 0.35) * 7));
    })
  );
}

// ---------- Temas ----------
const THEMES = {
  light: {
    levels: ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"],
    flash: "#ffffff", star: "#c9d1d9", laser: "#ff3d7f", laserCore: "#fff0f5",
    hull: "#4f5b93", hullLight: "#8a97d6", cockpit: "#7ee0ff", accent: "#ff3d7f",
    flame1: "#ffb020", flame2: "#ff5a1f", boom: "#ffcf4a",
    tankBody: "#5b6b3a", tankLight: "#8ea05a", track: "#2f3527",
  },
  dark: {
    levels: ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"],
    flash: "#e6fffa", star: "#8b949e", laser: "#ff4fd8", laserCore: "#ffffff",
    hull: "#9aa7ff", hullLight: "#d4dbff", cockpit: "#5ef0ff", accent: "#ff4fd8",
    flame1: "#ffd23f", flame2: "#ff6b2b", boom: "#ffe27a",
    tankBody: "#7d9450", tankLight: "#b5cc7a", track: "#3a4230",
  },
};

// ---------- Geometría ----------
const CELL = 10, PITCH = 13, PAD = 16;
const pct = (t, D) => ((t / D) * 100).toFixed(4) + "%";
const r2 = (n) => Math.round(n * 100) / 100;

function build(grid, theme, style) {
  const T = THEMES[theme];
  const cols = grid.length;
  const W = PAD * 2 + cols * PITCH - 3;
  const gridH = 7 * PITCH - 3;
  const SHIP_Y = PAD + gridH + 46;
  const H = SHIP_Y + 26;
  const MUZZLE_Y = SHIP_Y - 16;
  const cx = (c) => PAD + c * PITCH + CELL / 2;
  const cy = (r) => PAD + r * PITCH + CELL / 2;

  // ---- Plan de batalla ----
  const totalShots = grid.flat().reduce((a, l) => a + (l || 0), 0);
  const S = Math.min(0.11, Math.max(0.035, 50 / Math.max(1, totalShots))); // intervalo entre disparos
  const SPEED = 750; // px/s del proyectil
  const flight = (r) => (MUZZLE_Y - cy(r)) / SPEED;

  const shipStops = []; // [t, x]
  const shots = [];     // {t, c, r}
  const hits = new Map(); // "c,r" -> [tiempos de impacto]
  const startX = -40;
  let t = 0, x = startX;
  shipStops.push([0, startX]);
  let first = true;

  for (let c = 0; c < cols; c++) {
    const targets = [];
    for (let r = 6; r >= 0; r--) if (grid[c][r] > 0) targets.push(r); // de abajo hacia arriba
    if (!targets.length) continue;
    const nx = cx(c);
    const move = first ? 1.1 : Math.min(0.6, Math.max(0.07, Math.abs(nx - x) / 380));
    t += move;
    shipStops.push([t, nx]);
    x = nx;
    first = false;
    for (const r of targets) {
      for (let k = 0; k < grid[c][r]; k++) {
        shots.push({ t, c, r });
        const key = `${c},${r}`;
        if (!hits.has(key)) hits.set(key, []);
        hits.get(key).push(t + flight(r));
        t += S;
      }
    }
    shipStops.push([t, nx]);
  }

  const lastHit = Math.max(t, ...[...hits.values()].map((h) => h[h.length - 1]));
  const exitStart = lastHit + 0.5;
  const exitEnd = exitStart + (first ? 3 : 0.9);
  shipStops.push([exitStart, x]);
  shipStops.push([exitEnd, W + 40]);
  const regenStart = exitEnd + 0.2;
  const regenStagger = 0.012, regenFade = 0.5;
  const D = r2(regenStart + cols * regenStagger + regenFade + 0.6);

  // ---- CSS ----
  let css = "";
  const dur = `${D}s`;
  css += `.b{opacity:0;animation-duration:${dur};animation-iteration-count:infinite;animation-timing-function:linear}`;
  css += `.x>*{opacity:0;animation-delay:inherit;animation-duration:${dur};animation-iteration-count:infinite;animation-timing-function:cubic-bezier(.2,.7,.3,1)}`;

  // Nave: posición X
  css += `#sx{animation:sx ${dur} infinite}@keyframes sx{`;
  for (const [tt, xx] of shipStops)
    css += `${pct(tt, D)}{transform:translateX(${r2(xx)}px);animation-timing-function:ease-in-out}`;
  css += `100%{transform:translateX(${W + 40}px)}}`;

  // Proyectiles: un keyframe por fila
  const eps = 0.0002;
  for (let r = 0; r < 7; r++) {
    const dist = r2(MUZZLE_Y - cy(r));
    const p = (flight(r) / D) * 100;
    css += `.r${r}{animation-name:r${r}}@keyframes r${r}{0%{transform:translateY(0);opacity:1}${p.toFixed(4)}%{transform:translateY(-${dist}px);opacity:1}${(p + eps).toFixed(4)}%,100%{transform:translateY(-${dist}px);opacity:0}}`;
  }

  // Explosión compartida (se desfasa con animation-delay negativo)
  const q = ((0.45 / D) * 100).toFixed(4);
  css += `.f{animation-name:bf;fill:${T.boom}}@keyframes bf{0%{transform:scale(.2);opacity:1}${q}%{transform:scale(1.7);opacity:0}100%{opacity:0}}`;
  const dirs = [[-9, -10], [9, -10], [-10, 7], [10, 7], [0, -13]];
  dirs.forEach(([dx, dy], i) => {
    css += `.d${i}{animation-name:d${i}}@keyframes d${i}{0%{transform:translate(0,0) rotate(0);opacity:1}${q}%{transform:translate(${dx}px,${dy}px) rotate(${i % 2 ? 140 : -140}deg);opacity:0}100%{opacity:0}}`;
  });

  // Celdas: keyframes únicos (bajan de nivel con cada impacto)
  const flashT = Math.min(0.06, S * 0.6);
  let cellsSvg = "", fxSvg = "", shotsSvg = "";
  let idx = 0;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < 7; r++) {
      const L = grid[c][r];
      if (L === null || L === undefined) continue;
      const x0 = PAD + c * PITCH, y0 = PAD + r * PITCH;
      const h = hits.get(`${c},${r}`);
      if (!h) {
        cellsSvg += `<rect x="${x0}" y="${y0}" width="${CELL}" height="${CELL}" rx="2" fill="${T.levels[L]}"/>`;
        continue;
      }
      const id = `c${idx++}`;
      let kf = `0%{fill:${T.levels[L]}}`;
      h.forEach((ht, k) => {
        kf += `${pct(ht - 0.001, D)}{fill:${T.levels[L - k]}}`;
        kf += `${pct(ht, D)}{fill:${T.flash}}`;
        kf += `${pct(ht + flashT, D)}{fill:${T.levels[L - k - 1]}}`;
      });
      const rs = regenStart + c * regenStagger;
      kf += `${pct(rs, D)}{fill:${T.levels[0]}}${pct(rs + regenFade, D)},100%{fill:${T.levels[L]}}`;
      css += `.${id}{animation:${id} ${dur} infinite}@keyframes ${id}{${kf}}`;
      cellsSvg += `<rect class="${id}" x="${x0}" y="${y0}" width="${CELL}" height="${CELL}" rx="2" fill="${T.levels[L]}"/>`;

      // explosión en el impacto final
      const boomT = h[h.length - 1];
      fxSvg += `<g class="x" transform="translate(${cx(c)},${cy(r)})" fill="${T.levels[L]}" style="animation-delay:-${r2(D - boomT)}s"><circle class="f" r="6"/>`;
      dirs.forEach((_, i) => (fxSvg += `<rect class="d${i}" x="-1.5" y="-1.5" width="3" height="3"/>`));
      fxSvg += `</g>`;
    }
  }

  // Disparos
  for (const s of shots) {
    const bx = cx(s.c);
    const shape = style === "tank"
      ? `<circle class="b r${s.r}" cx="${bx}" cy="${MUZZLE_Y}" r="2.2"`
      : `<rect class="b r${s.r}" x="${bx - 1}" y="${MUZZLE_Y - 7}" width="2" height="8" rx="1"`;
    shotsSvg += `${shape} style="animation-delay:-${r2(D - s.t)}s"/>`;
  }

  // Estrellas de fondo
  let stars = "";
  let seed = 42;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 40; i++) {
    stars += `<circle class="st" cx="${r2(rnd() * W)}" cy="${r2(PAD + gridH + 8 + rnd() * (H - PAD - gridH - 10))}" r="${r2(0.4 + rnd() * 0.8)}" style="animation-delay:-${r2(rnd() * 3)}s"/>`;
  }
  css += `.st{fill:${T.star};animation:tw 3s ease-in-out infinite}@keyframes tw{0%,100%{opacity:.2}50%{opacity:.9}}`;
  css += `#bob{animation:bob 1.6s ease-in-out infinite}@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-2px)}}`;
  css += `.fl{animation:fl .12s steps(2) infinite;transform-origin:0 0}@keyframes fl{0%{transform:scaleY(1)}100%{transform:scaleY(.6)}}`;

  // ---- Vehículo ----
  const ship = `
    <g class="fl"><path d="M-4 9 L0 ${18} L4 9Z" fill="${T.flame2}"/><path d="M-2 9 L0 14 L2 9Z" fill="${T.flame1}"/></g>
    <path d="M0 -16 L4 -6 L4 4 L13 10 L13 12 L4 9 L-4 9 L-13 12 L-13 10 L-4 4 L-4 -6Z" fill="url(#hull)"/>
    <path d="M-13 10 L-13 4 L-11 4 L-11 9Z M13 10 L13 4 L11 4 L11 9Z" fill="${T.accent}"/>
    <ellipse cx="0" cy="-5" rx="2.2" ry="4" fill="${T.cockpit}"/>
    <ellipse cx="-0.7" cy="-6.5" rx="0.7" ry="1.4" fill="#fff" opacity=".7"/>`;
  const tank = `
    <rect x="-1.6" y="-17" width="3.2" height="12" rx="1" fill="${T.tankLight}"/>
    <rect x="-14" y="2" width="28" height="9" rx="4.5" fill="${T.track}"/>
    ${[-10, -5, 0, 5, 10].map((wx) => `<circle cx="${wx}" cy="6.5" r="2.2" fill="${T.tankBody}"/>`).join("")}
    <path d="M-12 3 L-9 -3 L9 -3 L12 3Z" fill="url(#hull)"/>
    <circle cx="0" cy="-4" r="5.5" fill="${T.tankBody}"/><circle cx="-1.5" cy="-5.5" r="1.6" fill="${T.tankLight}"/>`;
  const vehicle = style === "tank" ? tank : ship;
  const hullGrad = style === "tank"
    ? `<stop offset="0" stop-color="${T.tankLight}"/><stop offset="1" stop-color="${T.tankBody}"/>`
    : `<stop offset="0" stop-color="${T.hullLight}"/><stop offset="1" stop-color="${T.hull}"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<defs>
<linearGradient id="hull" x1="0" y1="0" x2="0" y2="1">${hullGrad}</linearGradient>
<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
</defs>
<style>${css}</style>
<g>${stars}</g>
<g>${cellsSvg}</g>
<g filter="url(#glow)" fill="${style === "tank" ? T.boom : T.laser}">${shotsSvg}</g>
<g>${fxSvg}</g>
<g transform="translate(0,${SHIP_Y})"><g id="sx"><g id="bob">${vehicle}</g></g></g>
</svg>`;
}

// ---------- Main ----------
const grid = DEMO ? demoGrid() : await fetchGrid(USER);
mkdirSync(OUT, { recursive: true });
const prefix = STYLE === "tank" ? "tank-shooter" : "space-shooter";
for (const theme of ["light", "dark"]) {
  const svg = build(grid, theme, STYLE);
  const file = join(OUT, `${prefix}-${theme}.svg`);
  writeFileSync(file, svg);
  console.log(`✔ ${file} (${(svg.length / 1024).toFixed(0)} KB)`);
}
