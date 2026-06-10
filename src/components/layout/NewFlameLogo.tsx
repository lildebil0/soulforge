import { fg as fgStyle, StyledText, TextAttributes, type TextRenderable } from "@opentui/core";
import { useEffect, useMemo, useRef } from "react";
import { isLowPowerMode } from "../../core/low-power.js";
import { useTheme } from "../../core/theme/index.js";

// ── Real-flame forge logo ────────────────────────────────────────────
//
// Flame: original Doom-fire sim from FlameLogo.tsx — same heat field,
// same random-drift propagation, same narrowing, same decay. Only the
// palette is warmed up to read as real fire instead of stylized plasma.
//
// Hammer: 3-frame rotating sledgehammer (REST → MID → STRIKE), poses
// generated from a real blacksmith hammer image via the
// rghvv/ASCII-Art-Generator technique (silhouette-fill + tile-density
// sampling). Motion state machine in live-ascii style: windup → strike
// → impact → recoil → settle. On impact, fires a spark burst, a flame
// surge into the source row, and briefly flashes the wordmark hotter.

// ── Warm fire palette — same chars as original, warm colors ─────────

interface HeatCell {
  ch: string;
  color: string;
}

// Real-flame gradient: hot core → warm body → red bridge → cool blue
// halo at the outer wisps. The blue tiers capture the cold combustion
// envelope you see at the boundary of a real flame, where the yellow
// body fades into the surrounding air.
function heatToCell(h: number): HeatCell {
  if (h >= 0.9) return { ch: "#", color: "#fffae8" }; // near-white core
  if (h >= 0.78) return { ch: "#", color: "#ffec82" }; // pale yellow
  if (h >= 0.64) return { ch: "*", color: "#ffcc48" }; // bright yellow
  if (h >= 0.5) return { ch: "*", color: "#ffa628" }; // amber
  if (h >= 0.38) return { ch: "+", color: "#ff801c" }; // warm orange
  if (h >= 0.28) return { ch: "=", color: "#f56118" }; // orange
  if (h >= 0.2) return { ch: "-", color: "#cc4220" }; // soft red-orange
  if (h >= 0.14) return { ch: ":", color: "#7a3858" }; // red→purple bridge
  if (h >= 0.09) return { ch: ":", color: "#4a4a95" }; // blue-purple halo
  if (h >= 0.05) return { ch: ".", color: "#2a3d82" }; // cool blue wisp
  if (h >= 0.02) return { ch: "·", color: "#1a2a5a" }; // faint blue
  return { ch: " ", color: "#0a0810" };
}

// Continuous color sampling — used for wordmark tint + sparks so the
// light they pick up is smoothly graded, not stepped.
type RGB = readonly [number, number, number];
type Stop = readonly [number, RGB];

const FIRE_STOPS: readonly Stop[] = [
  [1.0, [0xff, 0xfa, 0xe8]], // near-white
  [0.82, [0xff, 0xec, 0x82]], // pale yellow
  [0.64, [0xff, 0xcc, 0x48]], // bright yellow
  [0.5, [0xff, 0xa6, 0x28]], // amber
  [0.36, [0xff, 0x80, 0x1c]], // warm orange
  [0.22, [0xcc, 0x42, 0x20]], // soft red-orange
  [0.1, [0x55, 0x20, 0x28]], // dim ember
];

const BG_VOID: RGB = [0x0a, 0x08, 0x10];

function rgbToHex(r: number, g: number, b: number): string {
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function pickFireColor(heat: number): string {
  if (heat <= 0.04) return rgbToHex(BG_VOID[0], BG_VOID[1], BG_VOID[2]);
  const top = FIRE_STOPS[0];
  if (!top) return "#ffffff";
  if (heat >= top[0]) return rgbToHex(top[1][0], top[1][1], top[1][2]);
  for (let i = 0; i < FIRE_STOPS.length - 1; i++) {
    const s0 = FIRE_STOPS[i];
    const s1 = FIRE_STOPS[i + 1];
    if (!s0 || !s1) continue;
    if (heat <= s0[0] && heat >= s1[0]) {
      const t = (heat - s1[0]) / (s0[0] - s1[0]);
      const r = Math.round(s1[1][0] + (s0[1][0] - s1[1][0]) * t);
      const g = Math.round(s1[1][1] + (s0[1][1] - s1[1][1]) * t);
      const b = Math.round(s1[1][2] + (s0[1][2] - s1[1][2]) * t);
      return rgbToHex(r, g, b);
    }
  }
  const last = FIRE_STOPS[FIRE_STOPS.length - 1];
  if (!last) return "#000000";
  const t = Math.max(0, heat / last[0]);
  const r = Math.round(BG_VOID[0] + (last[1][0] - BG_VOID[0]) * t);
  const g = Math.round(BG_VOID[1] + (last[1][1] - BG_VOID[1]) * t);
  const b = Math.round(BG_VOID[2] + (last[1][2] - BG_VOID[2]) * t);
  return rgbToHex(r, g, b);
}

function lerpHex(a: string, b: string, t: number): string {
  const ar = parseInt(a.slice(1, 3), 16);
  const ag = parseInt(a.slice(3, 5), 16);
  const ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16);
  const bg = parseInt(b.slice(3, 5), 16);
  const bb = parseInt(b.slice(5, 7), 16);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return rgbToHex(r, g, bl);
}

// ── Heat sim — original Doom-fire logic ──────────────────────────────

// Flame occupies ~55% of the container's vertical space; the remainder
// is split between empty sky on top and the wordmark on bottom.
const FLAME_HEIGHT_RATIO = 0.55;

function computeTopHeadroom(rows: number, wordmarkRows: number): number {
  return Math.max(2, rows - Math.floor(rows * FLAME_HEIGHT_RATIO) - wordmarkRows);
}

interface FlameSim {
  cols: number;
  rows: number;
  heat: Float32Array;
  sourceMask: Float32Array;
  topHeadroom: number;
}

function makeSim(cols: number, rows: number, flameWidth: number, topHeadroom: number): FlameSim {
  const heat = new Float32Array(cols * rows);
  const sourceMask = new Float32Array(cols);
  const cx = (cols - 1) / 2;
  const halfW = flameWidth / 2;
  for (let x = 0; x < cols; x++) {
    const d = Math.abs(x - cx) / halfW;
    if (d >= 1) {
      sourceMask[x] = 0;
      continue;
    }
    const t = 1 - d;
    sourceMask[x] = t * t * (3 - 2 * t);
  }
  return { cols, rows, heat, sourceMask, topHeadroom };
}

interface Surge {
  startAt: number;
  endAt: number;
  center: number;
  width: number;
  strength: number;
}

function stepSim(
  sim: FlameSim,
  intensity: number,
  breath: number,
  surges: Surge[],
  t: number,
): void {
  const { cols, rows, heat, sourceMask, topHeadroom } = sim;
  const sourceY = rows - 1;
  const cx = (cols - 1) / 2;

  // 1. Source refresh + surge injection (hammer impact → flame flare).
  for (let x = 0; x < cols; x++) {
    const m = sourceMask[x] ?? 0;
    if (m === 0) {
      heat[sourceY * cols + x] = 0;
      continue;
    }
    const jitter = 0.75 + Math.random() * 0.25;
    let v = m * jitter * intensity * breath;
    for (const s of surges) {
      if (t < s.startAt || t > s.endAt) continue;
      const phase = (t - s.startAt) / (s.endAt - s.startAt);
      const envelope = Math.sin(phase * Math.PI);
      const dist = Math.abs(x - s.center);
      if (dist < s.width) {
        const falloff = 1 - (dist / s.width) ** 2;
        v += envelope * falloff * s.strength;
      }
    }
    heat[sourceY * cols + x] = Math.min(1, v);
  }

  // 2. Upward propagation. Two critical shape controls:
  //    - TOP_FADE is RELATIVE to topHeadroom (not absolute y), so extra
  //      decay kicks in as tongues approach the headroom boundary →
  //      tip fades smoothly into sparse embers instead of clipping flat.
  //    - Narrowing is quadratic and starts earlier → tip tapers to a
  //      point instead of staying wide to the top.
  const TOP_FADE_ROWS = 8;
  for (let y = topHeadroom; y < sourceY; y++) {
    // heightT: 1 at the TIP (y = topHeadroom-ish), 0 at the SOURCE
    // (y = sourceY). Use it directly as "closeness to tip".
    const heightT = 1 - y / Math.max(1, sourceY);
    // Narrowing strength ramps from 0 at mid-flame to 1 at the tip, so
    // the base stays wide and only the upper flame pulls to a point.
    const narrowStrength = Math.max(0, (heightT - 0.35) / 0.65);
    const inTopFade = y - topHeadroom;
    const fadeT = Math.max(0, (TOP_FADE_ROWS - inTopFade) / TOP_FADE_ROWS);
    const topFade = fadeT * fadeT * 0.05;
    for (let x = 0; x < cols; x++) {
      const toCenter = x < cx ? 1 : x > cx ? -1 : 0;
      let rand = Math.floor(Math.random() * 3) - 1;
      // Strong quadratic pull toward center near the tip → pointy /\.
      if (Math.random() < narrowStrength * narrowStrength * 1.2 + narrowStrength * 0.2) {
        rand = toCenter;
      }
      const srcX = Math.min(cols - 1, Math.max(0, x + rand));
      // More decay near tip than near source (heightT-weighted).
      const decay = Math.random() * 0.02 + 0.008 + heightT * 0.012 + topFade;
      const below = heat[(y + 1) * cols + srcX] ?? 0;
      heat[y * cols + x] = Math.max(0, below - decay);
    }
  }
}

// ── Sparks ───────────────────────────────────────────────────────────

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  temp: number;
}

// Rising embers. Sample from the upper-middle flame band (where heat
// is still high enough to qualify but close to the tip) and spawn
// faster-rising sparks so they visibly escape into the headroom.
function emitAmbientSparks(sparks: Spark[], sim: FlameSim, cap: number): void {
  if (sparks.length >= cap) return;
  const { cols, rows, heat, topHeadroom } = sim;
  const flameHeight = rows - topHeadroom;
  const bandTop = topHeadroom + Math.floor(flameHeight * 0.15);
  const bandBottom = topHeadroom + Math.floor(flameHeight * 0.55);
  const bandHeight = Math.max(1, bandBottom - bandTop);
  for (let i = 0; i < 4; i++) {
    if (sparks.length >= cap) return;
    const y = bandTop + Math.floor(Math.random() * bandHeight);
    const x = Math.floor(Math.random() * cols);
    const h = heat[y * cols + x] ?? 0;
    if (h > 0.5 && Math.random() < 0.22) {
      const life = 1.2 + Math.random() * 1.5;
      sparks.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 0.22,
        vy: -(0.18 + Math.random() * 0.3),
        life,
        maxLife: life,
        temp: Math.min(1, h + Math.random() * 0.08),
      });
    }
  }
}

function spawnImpactSparks(sparks: Spark[], impactX: number, impactY: number): void {
  const COUNT = 22;
  for (let i = 0; i < COUNT; i++) {
    const angle = -Math.PI + Math.random() * Math.PI;
    const speed = 0.4 + Math.random() * 0.9;
    const life = 0.55 + Math.random() * 0.9;
    sparks.push({
      x: impactX + (Math.random() - 0.5) * 3,
      y: impactY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed * 0.55,
      life,
      maxLife: life,
      temp: 0.9 + Math.random() * 0.08,
    });
  }
}

function updateSparks(sparks: Spark[], dt: number, rows: number): void {
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    if (!s) continue;
    s.x += s.vx * dt * 10;
    s.y += s.vy * dt * 10;
    s.vy -= 0.02;
    s.vy *= 0.99;
    s.life -= dt;
    s.temp *= 0.985;
    if (s.life <= 0 || s.y < -1 || s.y >= rows + 1) sparks.splice(i, 1);
  }
}

// ── Hammer frames (generated from blacksmith hammer image) ───────────

const HAMMER_REST = [
  "    ░▓▓▒·             ",
  "  ·▓█████·            ",
  " ▒███████░            ",
  "·█████████▒·          ",
  "▓████▓░▒████▓░        ",
  "···      ▒█████▒·     ",
  "           ░▓████▒·   ",
  "             ·▓████▒· ",
  "               ·▒████▒",
] as const;
const REST_W = 22;
const REST_H = 9;
const REST_PIVOT_X = 21;
const REST_PIVOT_Y = 8;
const REST_HEAD_ROWS = 5;

const HAMMER_MID = [
  "  ▓█▓▒░                 ",
  " ▓█████▒                ",
  "░███████▓▒░·            ",
  "▓████████████▓▒░·       ",
  "▓████▒  ·░▒▓██████▓▒░·  ",
  "░▓▒░        ··░▒▓██████▒",
  "                  ·░▒▓█▒",
] as const;
const MID_W = 24;
const MID_H = 7;
const MID_PIVOT_X = 23;
const MID_PIVOT_Y = 5;
const MID_HEAD_ROWS = 5;

const HAMMER_STRIKE = [
  "▒▓██▓▓·                   ",
  "▓█████▓▒▒▒▒▒▒▒▒▒▒▒▒░░░░░░·",
  "▓████████████████████████▓",
  "▓█████▓░░░░░░░░░░░░▒▒▒▒▒▒░",
  "·█████·                   ",
  " ░██▓·                    ",
] as const;
const STRIKE_W = 26;
const STRIKE_H = 6;
const STRIKE_PIVOT_X = 25;
const STRIKE_PIVOT_Y = 1;
const STRIKE_HEAD_BOTTOM_ROW = 5;

type HammerFrameKind = "rest" | "mid" | "strike";

interface HammerFrame {
  rows: readonly string[];
  w: number;
  h: number;
  pivotX: number;
  pivotY: number;
}

const FRAMES: Record<HammerFrameKind, HammerFrame> = {
  rest: { rows: HAMMER_REST, w: REST_W, h: REST_H, pivotX: REST_PIVOT_X, pivotY: REST_PIVOT_Y },
  mid: { rows: HAMMER_MID, w: MID_W, h: MID_H, pivotX: MID_PIVOT_X, pivotY: MID_PIVOT_Y },
  strike: {
    rows: HAMMER_STRIKE,
    w: STRIKE_W,
    h: STRIKE_H,
    pivotX: STRIKE_PIVOT_X,
    pivotY: STRIKE_PIVOT_Y,
  },
};

// ── Hammer motion state machine ──────────────────────────────────────

type HammerPhase = "idle" | "windup" | "strike" | "impact" | "recoil" | "settle";

interface HammerState {
  phase: HammerPhase;
  phaseStartT: number;
  nextStrikeT: number;
  lastImpactT: number;
}

function scheduleNextStrike(t: number): number {
  return t + 5 + Math.random() * 4;
}

interface HammerUpdate {
  frame: HammerFrameKind;
  yOffset: number;
  impact: boolean;
}

function updateHammer(s: HammerState, t: number): HammerUpdate {
  const elapsed = t - s.phaseStartT;

  switch (s.phase) {
    case "idle": {
      if (t >= s.nextStrikeT) {
        s.phase = "windup";
        s.phaseStartT = t;
        return { frame: "rest", yOffset: 0, impact: false };
      }
      const bob = Math.sin((t * Math.PI * 2) / 2.6) * 0.4;
      return { frame: "rest", yOffset: bob, impact: false };
    }
    case "windup": {
      const p = Math.min(1, elapsed / 0.55);
      const eased = 1 - (1 - p) * (1 - p);
      if (p >= 1) {
        s.phase = "strike";
        s.phaseStartT = t;
      }
      return { frame: "rest", yOffset: -eased * 3, impact: false };
    }
    case "strike": {
      const p = Math.min(1, elapsed / 0.22);
      let frame: HammerFrameKind;
      let yOffset = 0;
      if (p < 0.35) {
        frame = "rest";
        const q = p / 0.35;
        yOffset = -3 + 3 * (q * q);
      } else if (p < 0.7) {
        frame = "mid";
      } else {
        frame = "strike";
      }
      if (p >= 1) {
        s.phase = "impact";
        s.phaseStartT = t;
        s.lastImpactT = t;
        return { frame: "strike", yOffset: 0, impact: true };
      }
      return { frame, yOffset, impact: false };
    }
    case "impact": {
      if (elapsed >= 0.08) {
        s.phase = "recoil";
        s.phaseStartT = t;
      }
      return { frame: "strike", yOffset: 0, impact: false };
    }
    case "recoil": {
      const p = Math.min(1, elapsed / 0.3);
      let frame: HammerFrameKind;
      let yOffset = 0;
      if (p < 0.3) {
        frame = "strike";
      } else if (p < 0.65) {
        frame = "mid";
      } else {
        frame = "rest";
        const q = (p - 0.65) / 0.35;
        yOffset = -2 * (1 - (1 - q) ** 2);
      }
      if (p >= 1) {
        s.phase = "settle";
        s.phaseStartT = t;
      }
      return { frame, yOffset, impact: false };
    }
    case "settle": {
      const p = Math.min(1, elapsed / 0.65);
      const eased = 1 - (1 - p) ** 3;
      const bobTarget = Math.sin((t * Math.PI * 2) / 2.6) * 0.4;
      const yOffset = -2 + (bobTarget + 2) * eased;
      if (p >= 1) {
        s.phase = "idle";
        s.phaseStartT = t;
        s.nextStrikeT = scheduleNextStrike(t);
      }
      return { frame: "rest", yOffset, impact: false };
    }
  }
}

// ── Wordmark ─────────────────────────────────────────────────────────

const WORDMARK: readonly string[] = [
  "███████╗  ██████╗  ██╗   ██╗ ██╗      ███████╗  ██████╗  ██████╗   ██████╗  ███████╗",
  "██╔════╝ ██╔═══██╗ ██║   ██║ ██║      ██╔════╝ ██╔═══██╗ ██╔══██╗ ██╔════╝  ██╔════╝",
  "███████╗ ██║   ██║ ██║   ██║ ██║      █████╗   ██║   ██║ ██████╔╝ ██║  ███╗ █████╗  ",
  "╚════██║ ██║   ██║ ██║   ██║ ██║      ██╔══╝   ██║   ██║ ██╔══██╗ ██║   ██║ ██╔══╝  ",
  "███████║ ╚██████╔╝ ╚██████╔╝ ███████╗ ██║      ╚██████╔╝ ██║  ██║ ╚██████╔╝ ███████╗",
  "╚══════╝  ╚═════╝   ╚═════╝  ╚══════╝ ╚═╝       ╚═════╝  ╚═╝  ╚═╝  ╚═════╝  ╚══════╝",
];
const WM_W = WORDMARK[0]?.length ?? 0;

// ── Render helpers ───────────────────────────────────────────────────

function sampleNeighborHeat(
  heat: Float32Array,
  cols: number,
  rows: number,
  x: number,
  y: number,
): number {
  let weighted = heat[y * cols + x] ?? 0;
  for (let dy = -4; dy <= 1; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
      const h = heat[ny * cols + nx] ?? 0;
      if (h <= 0) continue;
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      const contribution = h / (dist + 1);
      if (contribution > weighted) weighted = contribution;
    }
  }
  return weighted;
}

function computeGlobalIntensity(heat: Float32Array, cols: number, flameEndY: number): number {
  let sum = 0;
  let count = 0;
  for (let y = 0; y < flameEndY; y++) {
    let rowMax = 0;
    for (let x = 0; x < cols; x++) {
      const h = heat[y * cols + x] ?? 0;
      if (h > rowMax) rowMax = h;
    }
    const weight = 1 - y / Math.max(1, flameEndY);
    sum += rowMax * weight;
    count += weight;
  }
  return count > 0 ? Math.min(1, sum / count) : 0;
}

interface HammerRender {
  frame: HammerFrameKind;
  originX: number;
  originY: number;
  flashStrength: number;
}

function hammerColorForCell(frame: HammerFrameKind, hy: number, flash: number): string {
  const headRows =
    frame === "rest" ? REST_HEAD_ROWS : frame === "mid" ? MID_HEAD_ROWS : STRIKE_HEAD_BOTTOM_ROW;
  const isStrikeFace = frame === "strike" && hy === STRIKE_HEAD_BOTTOM_ROW - 1;
  if (isStrikeFace && flash > 0.05) {
    return lerpHex("#d8d8e0", "#fff4b8", Math.min(1, flash));
  }
  if (hy <= headRows) {
    return hy === 0 ? "#8a8a94" : hy <= 2 ? "#b8b8c2" : "#9a9aa4";
  }
  return "#8a5a2c";
}

function renderComposite(
  sim: FlameSim,
  sparks: Spark[],
  hammer: HammerRender,
  wmBase: string,
  wmHighlight: string,
  wmShadow: string,
  dim: string,
  globalIntensity: number,
  breathPhase: number,
): StyledText {
  const { cols, rows, heat } = sim;
  const parts: ReturnType<ReturnType<typeof fgStyle>>[] = [];

  const wmRows = WORDMARK.length;
  const wmOff = Math.max(0, Math.floor((cols - WM_W) / 2));
  const wmStartY = rows - wmRows;

  const shadowDeepening = 1 - globalIntensity * 0.5;
  const deepShadow = lerpHex(wmShadow, dim, 1 - shadowDeepening);
  const breathMul = 0.82 + breathPhase * 0.18;
  const rowColors: string[] = [];
  for (let r = 0; r < wmRows; r++) {
    const tt = wmRows === 1 ? 0.5 : r / (wmRows - 1);
    const face =
      tt < 0.5 ? lerpHex(wmHighlight, wmBase, tt * 2) : lerpHex(wmBase, deepShadow, (tt - 0.5) * 2);
    rowColors.push(lerpHex(deepShadow, face, breathMul));
  }

  const sparkGrid = new Map<number, Spark>();
  for (const s of sparks) {
    const gx = Math.round(s.x);
    const gy = Math.round(s.y);
    if (gx < 0 || gx >= cols || gy < 0 || gy >= rows) continue;
    const key = gy * cols + gx;
    const existing = sparkGrid.get(key);
    if (!existing || s.temp > existing.temp) sparkGrid.set(key, s);
  }

  const tintStrength = globalIntensity < 0.2 ? 0 : ((globalIntensity - 0.2) / 0.8) ** 1.2;
  const frame = FRAMES[hammer.frame];

  for (let y = 0; y < rows; y++) {
    const inWordmark = y >= wmStartY;
    const wmRowIdx = y - wmStartY;
    const wmRow = inWordmark ? (WORDMARK[wmRowIdx] ?? "") : "";
    const baseColor = inWordmark ? (rowColors[wmRowIdx] ?? wmBase) : wmBase;

    for (let x = 0; x < cols; x++) {
      // Hammer overlay wins.
      const hx = x - hammer.originX;
      const hy = y - hammer.originY;
      if (hx >= 0 && hx < frame.w && hy >= 0 && hy < frame.h) {
        const hammerCh = frame.rows[hy]?.[hx];
        if (hammerCh && hammerCh !== " ") {
          const color = hammerColorForCell(hammer.frame, hy, hammer.flashStrength);
          parts.push(fgStyle(color)(hammerCh));
          continue;
        }
      }

      // Wordmark glyph with warm glow.
      if (inWordmark) {
        const wmX = x - wmOff;
        if (wmX >= 0 && wmX < wmRow.length) {
          const ch = wmRow[wmX];
          if (ch && ch !== " ") {
            const localHeat = sampleNeighborHeat(heat, cols, rows, x, y);
            const localScale = 0.7 + tintStrength;
            let tint = Math.min(1, localHeat * 1.4 * localScale + tintStrength * 0.7);
            if (hammer.flashStrength > 0) tint = Math.min(1, tint + hammer.flashStrength * 0.9);
            const tintHeat = Math.max(
              0.55,
              Math.min(1, localHeat + tintStrength * 0.25 + hammer.flashStrength * 0.4),
            );
            const tintColor = pickFireColor(tintHeat);
            const litColor = tint > 0.04 ? lerpHex(baseColor, tintColor, tint) : baseColor;
            parts.push(fgStyle(litColor)(ch));
            continue;
          }
        }
      }

      // Sparks.
      const spark = sparkGrid.get(y * cols + x);
      if (spark) {
        const lifeT = spark.life / spark.maxLife;
        const effectiveTemp = spark.temp * (0.35 + lifeT * 0.65);
        const glyph = lifeT > 0.65 ? "✦" : lifeT > 0.35 ? "∗" : "·";
        parts.push(fgStyle(pickFireColor(effectiveTemp))(glyph));
        continue;
      }

      // Flame — original heat→cell mapping with warm palette.
      const h = heat[y * cols + x] ?? 0;
      const { ch, color } = heatToCell(h);
      parts.push(fgStyle(color)(ch));
    }
    if (y < rows - 1) parts.push(fgStyle(dim)("\n"));
  }

  return new StyledText(parts);
}

// ── Component ────────────────────────────────────────────────────────

export interface NewFlameLogoProps {
  cols: number;
  rows: number;
}

const BOLD = TextAttributes.BOLD;

export function NewFlameLogo({ cols, rows }: NewFlameLogoProps) {
  const tk = useTheme();
  const ref = useRef<TextRenderable>(null);

  // Flame width — noticeably thinner than the wordmark so the
  // silhouette reads as a flame, not a fire wall.
  const flameWidth = useMemo(() => Math.min(cols - 4, Math.floor(WM_W * 0.62)), [cols]);
  const topHeadroom = useMemo(() => computeTopHeadroom(rows, WORDMARK.length), [rows]);
  const sim = useMemo(
    () => makeSim(cols, rows, flameWidth, topHeadroom),
    [cols, rows, flameWidth, topHeadroom],
  );

  const sparksRef = useRef<Spark[]>([]);
  const surgesRef = useRef<Surge[]>([]);
  const intensityRef = useRef(0);
  const breathRef = useRef(1);
  const breathPhaseRef = useRef(0.5);
  const globalIntensityRef = useRef(0);
  const startedAtRef = useRef(Date.now());

  const hammerRef = useRef<HammerState>({
    phase: "idle",
    phaseStartT: 0,
    nextStrikeT: 0,
    lastImpactT: 0,
  });
  const hammerYRef = useRef(0);
  const hammerFrameRef = useRef<HammerFrameKind>("rest");
  const flashRef = useRef(0);

  const wmStartY = rows - WORDMARK.length;
  const worldPivotY = wmStartY - 4;
  const worldPivotX = Math.floor(cols / 2) + 22;

  useEffect(() => {
    sim.heat.fill(0);
    sparksRef.current = [];
    surgesRef.current = [];
    intensityRef.current = 0;
    globalIntensityRef.current = 0;
    hammerYRef.current = 0;
    hammerFrameRef.current = "rest";
    flashRef.current = 0;
    startedAtRef.current = Date.now();
    const now = Date.now() * 0.001;
    hammerRef.current = {
      phase: "idle",
      phaseStartT: now,
      nextStrikeT: scheduleNextStrike(now),
      lastImpactT: 0,
    };
  }, [sim]);

  // Scalar updates @ 30fps.
  useEffect(() => {
    const INTRO_MS = 1200;
    const tick = () => {
      const now = Date.now();
      const elapsed = now - startedAtRef.current;
      const t = now * 0.001;

      // Original intensity curve — outExpo.
      const introT = Math.min(1, elapsed / INTRO_MS);
      intensityRef.current = introT >= 1 ? 1 : 1 - 2 ** (-10 * introT);

      // Breath — slower undertone pulse + a fast flicker LFO so the
      // source heat never sits still. Together they read as a living
      // fire, not a looping sim.
      if (intensityRef.current >= 0.999) {
        const phase = ((elapsed - INTRO_MS) / 2800) * Math.PI * 2;
        const breathCore = 1.025 + Math.sin(phase) * 0.075;
        // Fast flicker — ~3Hz, small amplitude, jittered.
        const flicker =
          Math.sin(t * 9) * 0.018 + Math.sin(t * 17) * 0.012 + (Math.random() - 0.5) * 0.02;
        breathRef.current = breathCore + flicker;
        breathPhaseRef.current = (Math.sin(phase) + 1) * 0.5;
      } else {
        breathRef.current = 1;
        breathPhaseRef.current = 0.5;
      }

      // Ambient surges — gentle flares every 2–4s so the flame
      // visibly licks upward without looking random-noisy.
      if (
        elapsed >= INTRO_MS &&
        Math.random() < 0.012 &&
        surgesRef.current.filter((s) => s.strength < 0.4 && s.endAt > t).length === 0
      ) {
        surgesRef.current.push({
          startAt: t,
          endAt: t + 0.5 + Math.random() * 0.4,
          center: cols / 2 + (Math.random() - 0.5) * (cols * 0.6),
          width: 8 + Math.random() * 10,
          strength: 0.2 + Math.random() * 0.15,
        });
      }

      // Hammer motion — advance state and smooth yOffset.
      const upd = updateHammer(hammerRef.current, t);
      hammerYRef.current += (upd.yOffset - hammerYRef.current) * 0.35;
      hammerFrameRef.current = upd.frame;

      // Decay impact flash.
      flashRef.current = Math.max(0, flashRef.current - 0.05);

      if (upd.impact && elapsed >= INTRO_MS) {
        const strikeFrame = FRAMES.strike;
        const strikeOriginX = worldPivotX - strikeFrame.pivotX;
        const strikeOriginY = worldPivotY - strikeFrame.pivotY;
        const impactX = strikeOriginX + 3;
        const impactY = strikeOriginY + STRIKE_HEAD_BOTTOM_ROW;
        spawnImpactSparks(sparksRef.current, impactX, impactY);
        surgesRef.current.push({
          startAt: t,
          endAt: t + 0.5,
          center: impactX,
          width: 20,
          strength: 0.6,
        });
        flashRef.current = 1;
      }

      if (surgesRef.current.length > 0) {
        surgesRef.current = surgesRef.current.filter((s) => s.endAt > t - 0.2);
      }
    };
    tick();
    const id = setInterval(tick, isLowPowerMode() ? 500 : 33);
    return () => clearInterval(id);
  }, [cols, worldPivotX, worldPivotY]);

  // Sim + render @ 10fps — original rate.
  useEffect(() => {
    const SIM_DT = 0.1;
    const id = setInterval(
      () => {
        try {
          const t = performance.now() * 0.001;
          stepSim(sim, intensityRef.current, breathRef.current, surgesRef.current, t);
          // Rising embers sampled from hot cells — subtle motion that
          // reads as "alive" between strikes.
          emitAmbientSparks(sparksRef.current, sim, 12);
          updateSparks(sparksRef.current, SIM_DT, rows);

          const flameEndY = rows - WORDMARK.length;
          const measured = computeGlobalIntensity(sim.heat, cols, flameEndY);
          globalIntensityRef.current = globalIntensityRef.current * 0.85 + measured * 0.15;

          if (ref.current) {
            const currentFrame = FRAMES[hammerFrameRef.current];
            const originX = worldPivotX - currentFrame.pivotX;
            const originY = worldPivotY - currentFrame.pivotY + Math.round(hammerYRef.current);
            ref.current.content = renderComposite(
              sim,
              sparksRef.current,
              {
                frame: hammerFrameRef.current,
                originX,
                originY,
                flashStrength: flashRef.current,
              },
              tk.brand,
              tk.brandAlt,
              tk.brandDim,
              tk.textFaint,
              globalIntensityRef.current,
              breathPhaseRef.current,
            );
          }
        } catch {
          // torn down mid-tick
        }
      },
      isLowPowerMode() ? 500 : 100,
    );
    return () => clearInterval(id);
  }, [sim, tk, cols, rows, worldPivotX, worldPivotY]);

  return (
    <box flexDirection="column" alignItems="center" gap={0}>
      <text ref={ref} attributes={BOLD}>
        {" "}
      </text>
    </box>
  );
}

export const WORDMARK_ROWS = WORDMARK.length;
