// Jigsaw cutter: potong gambar jadi piece interlocking dengan kurva
// bezier (tabs/blanks). Deterministik: seed + ukuran gambar + jumlah
// piece yang sama selalu menghasilkan potongan yang persis sama.

import { mulberry32 } from "./prng";

export interface EdgeSpec {
  // 0 = tepi lurus (pinggir puzzle), 1 = tab keluar, -1 = blank ke dalam.
  // Tanda selalu relatif terhadap arah luar piece pemilik tepi ini.
  sign: -1 | 0 | 1;
  // Tinggi tab sebagai fraksi dari panjang tepi (0.16 - 0.22).
  size: number;
  // Posisi tengah tab sepanjang tepi (0.42 - 0.58), diukur searah
  // penelusuran path piece (searah jarum jam dari pojok kiri atas).
  offset: number;
}

export interface PieceSpec {
  id: number;
  row: number;
  col: number;
  // Posisi benar di koordinat gambar (pojok kiri atas piece).
  x: number;
  y: number;
  w: number;
  h: number;
  top: EdgeSpec;
  right: EdgeSpec;
  bottom: EdgeSpec;
  left: EdgeSpec;
}

export interface CutResult {
  cols: number;
  rows: number;
  pieceW: number;
  pieceH: number;
  pieces: PieceSpec[];
}

function flatEdge(): EdgeSpec {
  return { sign: 0, size: 0, offset: 0.5 };
}

function randomEdge(rng: () => number): EdgeSpec {
  return {
    sign: rng() < 0.5 ? 1 : -1,
    size: 0.16 + rng() * 0.06,
    offset: 0.42 + rng() * 0.16,
  };
}

// Balik tepi untuk piece tetangga: tanda dibalik (tab jadi blank) dan
// offset dicerminkan karena arah penelusuran tetangga berlawanan.
function flipEdge(edge: EdgeSpec): EdgeSpec {
  return {
    sign: (edge.sign * -1) as -1 | 1,
    size: edge.size,
    offset: 1 - edge.offset,
  };
}

// Ambil tepi dari grid yang sudah dibangun penuh. Indeks selalu valid
// karena pemanggil hanya meminta tepi interior yang pasti ada.
function edgeAt(edges: EdgeSpec[][], r: number, c: number): EdgeSpec {
  return edges[r]![c]!;
}

// Pilih grid cols x rows yang hasil kalinya tepat pieceCount dan
// rasionya paling dekat dengan rasio gambar.
export function pickGrid(
  pieceCount: number,
  aspect: number,
): { cols: number; rows: number } {
  let best = { cols: pieceCount, rows: 1 };
  let bestDiff = Infinity;
  for (let cols = 1; cols <= pieceCount; cols++) {
    if (pieceCount % cols !== 0) continue;
    const rows = pieceCount / cols;
    const diff = Math.abs(cols / rows - aspect);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = { cols, rows };
    }
  }
  return best;
}

// Grid "bagus": bukan strip (sisi terkecil minimal 3) dan piece-nya
// tidak terlalu lonjong (aspek piece 0,6 - 1,67, simetris untuk
// gambar landscape maupun portrait).
export function isGoodGrid(
  cols: number,
  rows: number,
  aspect: number,
): boolean {
  if (Math.min(cols, rows) < 3) return false;
  const pieceAspect = (aspect * rows) / cols;
  return pieceAspect >= 0.6 && pieceAspect <= 1.67;
}

export interface RoundedCount {
  count: number;
  cols: number;
  rows: number;
}

// Bulatkan jumlah piece yang diminta ke angka terdekat yang punya grid
// bagus. Dipakai untuk input custom (12-500): angka prima seperti 97
// gridnya jelek (97x1), dibulatkan ke 98 (14x7). Preset 24/48/100/200
// tidak berubah karena gridnya sudah bagus. Kalau dua angka sama
// dekatnya, yang lebih besar yang menang.
export function roundPieceCount(
  requested: number,
  imageW: number,
  imageH: number,
): RoundedCount {
  const aspect = imageW / imageH;
  const target = Math.min(500, Math.max(12, Math.round(requested)));
  for (let delta = 0; delta <= 100; delta++) {
    const candidates =
      delta === 0 ? [target] : [target + delta, target - delta];
    for (const n of candidates) {
      if (n < 12 || n > 500) continue;
      const { cols, rows } = pickGrid(n, aspect);
      if (isGoodGrid(cols, rows, aspect)) return { count: n, cols, rows };
    }
  }
  // Fallback (praktis tidak pernah terjadi di 12-500).
  const { cols, rows } = pickGrid(target, aspect);
  return { count: target, cols, rows };
}

export function cutPuzzle(
  imageW: number,
  imageH: number,
  pieceCount: number,
  seed: number,
): CutResult {
  const { cols, rows } = pickGrid(pieceCount, imageW / imageH);
  const pieceW = imageW / cols;
  const pieceH = imageH / rows;
  const rng = mulberry32(seed);

  // Tepi vertikal antar kolom: vEdges[r][c] = tepi antara piece
  // (r, c) dan (r, c+1). Disimpan sekali, dipakai dua piece dengan
  // tanda berlawanan supaya tab dan blank saling mengunci.
  const vEdges: EdgeSpec[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: EdgeSpec[] = [];
    for (let c = 0; c < cols - 1; c++) {
      row.push(randomEdge(rng));
    }
    vEdges.push(row);
  }
  // Tepi horizontal antar baris: hEdges[r][c] = tepi antara piece
  // (r, c) dan (r+1, c).
  const hEdges: EdgeSpec[][] = [];
  for (let r = 0; r < rows - 1; r++) {
    const row: EdgeSpec[] = [];
    for (let c = 0; c < cols; c++) {
      row.push(randomEdge(rng));
    }
    hEdges.push(row);
  }

  const pieces: PieceSpec[] = [];
  let id = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      pieces.push({
        id: id++,
        row: r,
        col: c,
        x: c * pieceW,
        y: r * pieceH,
        w: pieceW,
        h: pieceH,
        top: r === 0 ? flatEdge() : flipEdge(edgeAt(hEdges, r - 1, c)),
        right: c === cols - 1 ? flatEdge() : edgeAt(vEdges, r, c),
        bottom: r === rows - 1 ? flatEdge() : edgeAt(hEdges, r, c),
        left: c === 0 ? flatEdge() : flipEdge(edgeAt(vEdges, r, c - 1)),
      });
    }
  }

  return { cols, rows, pieceW, pieceH, pieces };
}
