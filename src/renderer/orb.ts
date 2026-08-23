/**
 * The reactor orb: a canvas-rendered status core in the composer. One glance
 * tells you what Jarvis is doing — idle, listening (audio-reactive), hearing
 * speech, thinking, speaking, or waiting for an approval.
 */

export type OrbMode =
  | "off"
  | "starting"
  | "listening"
  | "speech"
  | "thinking"
  | "speaking"
  | "confirm";

const CYAN = [82, 214, 244] as const;
const AMBER = [242, 178, 76] as const;
const DIM = [125, 147, 161] as const;

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let mode: OrbMode = "off";
let level = 0;
let smoothLevel = 0;
let rafId = 0;
let reducedMotion = false;

export function setOrbMode(next: OrbMode): void {
  mode = next;
}

export function setOrbLevel(next: number): void {
  level = Math.max(0, Math.min(1, next));
}

function rgba(color: readonly [number, number, number] | readonly number[], alpha: number): string {
  return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
}

function palette(): readonly number[] {
  switch (mode) {
    case "confirm":
      return AMBER;
    case "off":
      return DIM;
    default:
      return CYAN;
  }
}

function draw(time: number): void {
  if (!ctx || !canvas) return;
  const w = canvas.width;
  const h = canvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const base = Math.min(w, h) / 2;
  ctx.clearRect(0, 0, w, h);

  const color = palette();
  const t = time / 1000;
  smoothLevel += (level - smoothLevel) * 0.25;

  const active = mode !== "off";
  const pulse = reducedMotion ? 0 : Math.sin(t * (mode === "speaking" ? 5 : 2)) * 0.5 + 0.5;

  // Core glow.
  const coreBoost =
    mode === "listening" || mode === "speech" ? smoothLevel * 0.5 : mode === "speaking" ? pulse * 0.25 : 0;
  const coreRadius = base * (0.2 + coreBoost * 0.35);
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, base * 0.85);
  glow.addColorStop(0, rgba(color, active ? 0.85 : 0.25));
  glow.addColorStop(0.35, rgba(color, active ? 0.28 + coreBoost : 0.08));
  glow.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, base * 0.85, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = rgba(color, active ? 0.95 : 0.4);
  ctx.beginPath();
  ctx.arc(cx, cy, coreRadius, 0, Math.PI * 2);
  ctx.fill();

  // Outer ring.
  ctx.lineWidth = Math.max(1.5, base * 0.055);
  ctx.strokeStyle = rgba(color, active ? 0.55 + (mode === "confirm" ? pulse * 0.35 : 0) : 0.3);
  ctx.beginPath();
  ctx.arc(cx, cy, base * 0.86, 0, Math.PI * 2);
  ctx.stroke();

  // Thinking / transcribing: two rotating arc segments.
  if (mode === "thinking" || mode === "starting") {
    const spin = reducedMotion ? 0 : t * 2.4;
    ctx.lineWidth = Math.max(2, base * 0.075);
    ctx.strokeStyle = rgba(color, 0.9);
    for (const phase of [0, Math.PI]) {
      ctx.beginPath();
      ctx.arc(cx, cy, base * 0.62, spin + phase, spin + phase + Math.PI * 0.55);
      ctx.stroke();
    }
  }

  // Listening / speech: radial audio-reactive ticks.
  if (mode === "listening" || mode === "speech") {
    const ticks = 24;
    const inner = base * 0.52;
    ctx.lineWidth = Math.max(1.5, base * 0.045);
    for (let i = 0; i < ticks; i++) {
      const angle = (i / ticks) * Math.PI * 2 + (reducedMotion ? 0 : t * 0.35);
      const wobble = reducedMotion
        ? smoothLevel
        : smoothLevel * (0.55 + 0.45 * Math.sin(t * 7 + i * 1.7));
      const len = base * 0.08 + base * 0.2 * wobble * (mode === "speech" ? 1.25 : 1);
      ctx.strokeStyle = rgba(color, 0.35 + 0.6 * wobble);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
      ctx.lineTo(cx + Math.cos(angle) * (inner + len), cy + Math.sin(angle) * (inner + len));
      ctx.stroke();
    }
  }

  // Speaking: expanding rings.
  if (mode === "speaking" && !reducedMotion) {
    for (const offset of [0, 0.5]) {
      const progress = (t * 0.9 + offset) % 1;
      ctx.lineWidth = Math.max(1, base * 0.035);
      ctx.strokeStyle = rgba(color, (1 - progress) * 0.5);
      ctx.beginPath();
      ctx.arc(cx, cy, base * (0.3 + progress * 0.52), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  rafId = requestAnimationFrame(draw);
}

export function initOrb(target: HTMLCanvasElement): void {
  canvas = target;
  ctx = target.getContext("2d");
  reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window
    .matchMedia("(prefers-reduced-motion: reduce)")
    .addEventListener("change", (e) => {
      reducedMotion = e.matches;
    });
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(draw);
}
