import type { Scenario } from "../../core/model";
import type { PlaybackSnapshot } from "../../runtime/protocol";
const C = {
  paper: "#f3f7fb",
  grid: "#dce6ef",
  ink: "#14263d",
  muted: "#65768a",
  blue: "#3458d4",
  teal: "#087e8b",
  orange: "#b86d12",
  white: "#ffffff",
};
export interface RenderOptions {
  showSensors: boolean;
  sensorOnly: boolean;
  showTrail: boolean;
}
export class ArenaRenderer {
  private staticLayer = document.createElement("canvas");
  private scenario: Scenario | null = null;
  private width = 0;
  private height = 0;
  private playbackId: string | null = null;
  private lastTick = -1;
  private trail: { x: number; y: number }[] = [];
  constructor(private canvas: HTMLCanvasElement) {}
  draw(
    scenario: Scenario | null,
    frame: PlaybackSnapshot | null,
    options: RenderOptions,
  ) {
    const rect = this.canvas.getBoundingClientRect(),
      ratio = Math.min(devicePixelRatio || 1, 2),
      width = Math.max(1, Math.round(rect.width * ratio)),
      height = Math.max(1, Math.round(rect.height * ratio));
    if (!scenario) {
      this.canvas.width = width;
      this.canvas.height = height;
      return;
    }
    if (
      this.scenario?.hash !== scenario.hash ||
      width !== this.width ||
      height !== this.height
    ) {
      this.scenario = scenario;
      this.width = width;
      this.height = height;
      this.canvas.width = width;
      this.canvas.height = height;
      this.staticLayer.width = width;
      this.staticLayer.height = height;
      const bg = this.staticLayer.getContext("2d")!;
      bg.fillStyle = C.paper;
      bg.fillRect(0, 0, width, height);
      const scale = Math.min(
        width / scenario.config.width,
        height / scenario.config.height,
      );
      bg.setTransform(
        scale,
        0,
        0,
        scale,
        (width - scenario.config.width * scale) / 2,
        (height - scenario.config.height * scale) / 2,
      );
      this.background(bg, scenario);
    }
    const ctx = this.canvas.getContext("2d")!,
      c = scenario.config;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(this.staticLayer, 0, 0);
    const scale = Math.min(width / c.width, height / c.height);
    ctx.setTransform(
      scale,
      0,
      0,
      scale,
      (width - c.width * scale) / 2,
      (height - c.height * scale) / 2,
    );
    const state = frame?.state ?? {
      ...scenario.start,
      remaining: scenario.food.map(() => true),
    };
    if (
      frame?.playbackId !== this.playbackId ||
      ("tick" in state && state.tick < this.lastTick)
    ) {
      this.trail = [];
      this.playbackId = frame?.playbackId ?? null;
      this.lastTick = -1;
    }
    if (frame && frame.state.tick !== this.lastTick) {
      this.trail.push({ x: state.x, y: state.y });
      this.trail = this.trail.slice(-200);
      this.lastTick = frame.state.tick;
    }
    if (options.sensorOnly) {
      ctx.fillStyle = C.paper;
      ctx.fillRect(0, 0, c.width, c.height);
      this.sensors(ctx, frame, c.width / 2, c.height / 2, 0, c.sensorRange);
      this.body(ctx, c.width / 2, c.height / 2, 0, c.bodyRadius);
      ctx.font = "15px ui-monospace, monospace";
      ctx.fillStyle = C.muted;
      ctx.textAlign = "center";
      ctx.fillText(
        frame?.decision
          ? `Decision ${frame.decision.tick} · body-relative readings`
          : "Step a decision to see observations",
        c.width / 2,
        c.height - 36,
      );
      return;
    }
    if (options.showTrail && this.trail.length > 1) {
      ctx.strokeStyle = "#3458d455";
      ctx.lineWidth = 2;
      ctx.beginPath();
      this.trail.forEach((p, i) =>
        i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y),
      );
      ctx.stroke();
    }
    scenario.food.forEach((food, i) => {
      if (state.remaining[i]) {
        ctx.fillStyle = C.teal;
        ctx.beginPath();
        ctx.arc(food.x, food.y, c.foodRadius, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    if (options.showSensors && frame?.decision) {
      const d = frame.decision;
      this.sensors(ctx, frame, d.x, d.y, d.heading, c.sensorRange);
    }
    this.body(ctx, state.x, state.y, state.heading, c.bodyRadius);
  }
  private background(ctx: CanvasRenderingContext2D, s: Scenario) {
    const c = s.config;
    ctx.fillStyle = C.paper;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 0.65;
    ctx.beginPath();
    for (let x = 0; x < c.width; x += 40) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, c.height);
    }
    for (let y = 0; y < c.height; y += 40) {
      ctx.moveTo(0, y);
      ctx.lineTo(c.width, y);
    }
    ctx.stroke();
    ctx.strokeStyle = "#aabacb";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, c.width - 2, c.height - 2);
    for (const o of s.obstacles) {
      ctx.fillStyle = "#31465e";
      ctx.fillRect(o.x, o.y, o.width, o.height);
      ctx.strokeStyle = "#14263d";
      ctx.strokeRect(o.x, o.y, o.width, o.height);
    }
  }
  private body(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    heading: number,
    r: number,
  ) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(heading);
    ctx.strokeStyle = "#3458d466";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, r + 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = C.blue;
    ctx.strokeStyle = C.white;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, r + 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = C.white;
    ctx.beginPath();
    ctx.moveTo(-3, -4);
    ctx.lineTo(5, 0);
    ctx.lineTo(-3, 4);
    ctx.stroke();
    ctx.restore();
  }
  private sensors(
    ctx: CanvasRenderingContext2D,
    frame: PlaybackSnapshot | null,
    x: number,
    y: number,
    heading: number,
    range: number,
  ) {
    const inputs = frame?.decision?.inputs;
    if (!inputs) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(heading);
    for (let i = 0; i < 8; i++) {
      const angle = (i * Math.PI) / 4;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, range, angle - Math.PI / 8, angle + Math.PI / 8);
      ctx.closePath();
      ctx.fillStyle = `rgba(8,126,139,${0.025 + inputs[i] * 0.25})`;
      ctx.fill();
      ctx.strokeStyle = "#087e8b33";
      ctx.lineWidth = 0.7;
      ctx.stroke();
      const detected = inputs[8 + i] > 0,
        distance = (1 - inputs[8 + i]) * range;
      ctx.strokeStyle = detected ? C.orange : "#65768a66";
      ctx.lineWidth = detected ? 2 : 1;
      ctx.setLineDash(detected ? [] : [3, 5]);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(angle) * distance, Math.sin(angle) * distance);
      ctx.stroke();
      ctx.setLineDash([]);
      if (detected) {
        ctx.fillStyle = C.orange;
        ctx.beginPath();
        ctx.arc(
          Math.cos(angle) * distance,
          Math.sin(angle) * distance,
          3,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }
    ctx.restore();
  }
}
