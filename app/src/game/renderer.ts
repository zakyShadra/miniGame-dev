// Renderer Canvas 2D: gambar piece jigsaw dengan clip path bezier,
// latar papan felt, dan area target. Semua warna dari DESIGN.md.

import type { PieceSpec } from "../../../shared/game/cutter";

export const BOARD_THEME = {
  felt: "#87a8c8",
  feltDot: "rgba(255, 255, 255, 0.10)",
  frame: "#1a3d4a",
  targetInner: "#faf5e8",
  pieceStroke: "rgba(10, 10, 10, 0.20)",
  highlight: "#ff6b5a",
  ghostAlpha: 0.35,
} as const;

// Margin gambar di sekeliling piece (fraksi ukuran piece) supaya tab
// yang menjorok ke area tetangga ikut kegambar di dalam clip.
const TAB_MARGIN = 0.25;

// Gambar satu tepi ke path. (x0,y0)->(x1,y1) adalah tepi lurus,
// (nx,ny) normal luar piece (satuan), sign dari EdgeSpec.
function traceEdge(
  path: Path2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  nx: number,
  ny: number,
  sign: -1 | 0 | 1,
  size: number,
  offset: number,
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  if (sign === 0) {
    path.lineTo(x1, y1);
    return;
  }
  // Titik lokal (u sepanjang tepi, v ke arah luar) -> kanvas.
  // sign -1 membalik v sehingga knob masuk ke dalam piece.
  const pt = (u: number, v: number): [number, number] => [
    x0 + ux * u + nx * v * sign,
    y0 + uy * u + ny * v * sign,
  ];
  const h = size * len;
  const o = offset * len;
  const [ax, ay] = pt(o - 0.16 * len, 0);
  const [c1x, c1y] = pt(o - 0.15 * len, 0.02 * h);
  const [c2x, c2y] = pt(o - 0.145 * len, 0.2 * h);
  const [bx, by] = pt(o - 0.12 * len, 0.45 * h);
  const [c3x, c3y] = pt(o - 0.11 * len, 0.75 * h);
  const [c4x, c4y] = pt(o - 0.08 * len, h);
  const [dx2, dy2] = pt(o, h);
  const [c5x, c5y] = pt(o + 0.08 * len, h);
  const [c6x, c6y] = pt(o + 0.11 * len, 0.75 * h);
  const [fx, fy] = pt(o + 0.12 * len, 0.45 * h);
  const [c7x, c7y] = pt(o + 0.145 * len, 0.2 * h);
  const [c8x, c8y] = pt(o + 0.15 * len, 0.02 * h);
  const [gx, gy] = pt(o + 0.16 * len, 0);
  path.lineTo(ax, ay);
  path.bezierCurveTo(c1x, c1y, c2x, c2y, bx, by);
  path.bezierCurveTo(c3x, c3y, c4x, c4y, dx2, dy2);
  path.bezierCurveTo(c5x, c5y, c6x, c6y, fx, fy);
  path.bezierCurveTo(c7x, c7y, c8x, c8y, gx, gy);
  path.lineTo(x1, y1);
}

// Path piece di koordinat lokal: (0,0) = pojok kiri atas kotak piece,
// skala = px board per px gambar. Path bisa menjorok ke koordinat
// negatif di tepi yang punya tab keluar.
export function piecePath(spec: PieceSpec, scale: number): Path2D {
  const w = spec.w * scale;
  const h = spec.h * scale;
  const path = new Path2D();
  path.moveTo(0, 0);
  traceEdge(path, 0, 0, w, 0, 0, -1, spec.top.sign, spec.top.size, spec.top.offset);
  traceEdge(path, w, 0, w, h, 1, 0, spec.right.sign, spec.right.size, spec.right.offset);
  traceEdge(path, w, h, 0, h, 0, 1, spec.bottom.sign, spec.bottom.size, spec.bottom.offset);
  traceEdge(path, 0, h, 0, 0, -1, 0, spec.left.sign, spec.left.size, spec.left.offset);
  path.closePath();
  return path;
}

// Path piece yang sudah digeser ke posisi (x, y) di board. Dipakai
// untuk hit-test (ctx.isPointInPath) di BoardCanvas.
export function piecePathAt(
  spec: PieceSpec,
  scale: number,
  x: number,
  y: number,
): Path2D {
  const path = new Path2D();
  path.addPath(piecePath(spec, scale), new DOMMatrix().translate(x, y));
  return path;
}

export interface DrawPieceOptions {
  highlight?: boolean;
  placed?: boolean;
  // Warna pemain yang sedang memegang piece ini (multiplayer): garis
  // tepi piece memakai warna pemain itu.
  lockColor?: string;
}

// Gambar satu piece di posisi (x, y) board. Gambar dipotong dari foto
// dengan margin supaya tab terisi piksel tetangga yang benar.
export function drawPiece(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  imgW: number,
  imgH: number,
  spec: PieceSpec,
  x: number,
  y: number,
  scale: number,
  opts: DrawPieceOptions = {},
): void {
  const path = piecePathAt(spec, scale, x, y);
  const mx = TAB_MARGIN * spec.w;
  const my = TAB_MARGIN * spec.h;
  let sx = spec.x - mx;
  let sy = spec.y - my;
  let sw = spec.w + mx * 2;
  let sh = spec.h + my * 2;
  let dx = x - mx * scale;
  let dy = y - my * scale;
  if (sx < 0) {
    dx += -sx * scale;
    sw += sx;
    sx = 0;
  }
  if (sy < 0) {
    dy += -sy * scale;
    sh += sy;
    sy = 0;
  }
  if (sx + sw > imgW) sw = imgW - sx;
  if (sy + sh > imgH) sh = imgH - sy;

  ctx.save();
  ctx.clip(path);
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, sw * scale, sh * scale);
  ctx.restore();

  ctx.save();
  if (opts.highlight) {
    ctx.shadowColor = "rgba(10, 10, 10, 0.30)";
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 4;
  } else if (!opts.placed) {
    ctx.shadowColor = "rgba(10, 10, 10, 0.15)";
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 2;
  }
  ctx.strokeStyle = opts.lockColor
    ? opts.lockColor
    : opts.highlight
      ? BOARD_THEME.highlight
      : BOARD_THEME.pieceStroke;
  ctx.lineWidth = opts.lockColor || opts.highlight ? 2.5 : 1;
  ctx.stroke(path);
  ctx.restore();
}

// Cursor pemain lain: panah + label nama, di koordinat board logis.
export function drawCursor(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  name: string,
  color: string,
): void {
  ctx.save();
  // Panah cursor (bentuk pointer mouse klasik).
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + 14, y + 14);
  ctx.lineTo(x + 8.5, y + 14);
  ctx.lineTo(x + 11, y + 21);
  ctx.lineTo(x + 14.5, y + 19.5);
  ctx.lineTo(x + 12, y + 12.5);
  ctx.lineTo(x + 18, y + 12.5);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // Label nama.
  ctx.font = "600 13px Inter, sans-serif";
  const padX = 7;
  const textW = ctx.measureText(name).width;
  const labelX = x + 16;
  const labelY = y + 14;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(labelX, labelY, textW + padX * 2, 22, 11);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.fillText(name, labelX + padX, labelY + 15.5);
  ctx.restore();
}

// Latar papan felt + pola titik halus (digambar di koordinat board).
export function drawBoardBackground(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
): void {
  ctx.save();
  ctx.fillStyle = BOARD_THEME.felt;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = BOARD_THEME.feltDot;
  const gap = 24;
  for (let y = gap / 2; y < h; y += gap) {
    for (let x = gap / 2; x < w; x += gap) {
      ctx.beginPath();
      ctx.arc(x, y, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

// Area target (tempat puzzle selesai): bingkai + bayangan foto yang
// sudah jadi sebagai panduan samar.
export function drawTargetArea(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  tx: number,
  ty: number,
  tw: number,
  th: number,
  showGhost: boolean,
): void {
  ctx.save();
  ctx.fillStyle = BOARD_THEME.frame;
  ctx.fillRect(tx - 6, ty - 6, tw + 12, th + 12);
  ctx.fillStyle = BOARD_THEME.targetInner;
  ctx.fillRect(tx, ty, tw, th);
  if (showGhost) {
    ctx.globalAlpha = BOARD_THEME.ghostAlpha;
    ctx.drawImage(img, tx, ty, tw, th);
  }
  ctx.restore();
}
