// R04-b: ruling-line PDF table reconstruction. Pure functions over pdf.js
// operator lists and text items; no I/O. A table is rebuilt only when its grid,
// merged cells, item placement and header are all certain. Anything uncertain
// returns null so the caller keeps the original text order instead of guessing.

export type PdfTextItem = {
  index: number;
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
};
export type PdfOperators = {
  save: number;
  restore: number;
  transform: number;
  constructPath: number;
  stroke: readonly number[];
  fill: readonly number[];
};
type Segment = { at: number; from: number; to: number };
type Rules = { horizontal: Segment[]; vertical: Segment[] };
type Cell = {
  r0: number;
  r1: number;
  c0: number;
  c1: number;
  units: number;
  words: Array<{ x: number; y: number; h: number; text: string }>;
  text: string;
};
export type PdfTable = {
  /** Text items fully represented by this table, in their original indexes. */
  itemIndexes: number[];
  /** Rendered rows; each is one self-contained line. */
  lines: string[];
};

export const PDF_TABLE_LIMITS = Object.freeze({
  segments: 4000,
  tablesPerPage: 20,
  rows: 200,
  columns: 40,
  headerRows: 6,
});
const TOL = 1.5;
const RULE = 2.5;

type Matrix = [number, number, number, number, number, number];
const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const point = (m: Matrix, x: number, y: number): [number, number] => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
];
const finite = (...values: number[]) => values.every(Number.isFinite);

// Drawn rules only: stroked axis-aligned edges and thin filled rectangles.
// Clipping paths and background fills are ignored. Unknown path data aborts.
export function pdfRules(
  fnArray: ArrayLike<number>,
  argsArray: ArrayLike<unknown>,
  ops: PdfOperators,
): Rules | null {
  const horizontal: Segment[] = [];
  const vertical: Segment[] = [];
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  const add = (list: Segment[], at: number, from: number, to: number) => {
    if (!finite(at, from, to)) return false;
    list.push({ at, from: Math.min(from, to), to: Math.max(from, to) });
    return horizontal.length + vertical.length <= PDF_TABLE_LIMITS.segments;
  };
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i] as unknown[] | null | undefined;
    if (fn === ops.save) {
      if (stack.length > 1000) return null;
      stack.push(ctm);
    } else if (fn === ops.restore) ctm = stack.pop() ?? ctm;
    else if (fn === ops.transform) {
      const m = Array.from((args ?? []) as ArrayLike<number>);
      if (m.length !== 6 || !finite(...m)) return null;
      ctm = multiply(ctm, m as Matrix);
    } else if (fn === ops.constructPath) {
      const paint = args?.[0];
      const stroked = ops.stroke.includes(paint as number);
      const filled = ops.fill.includes(paint as number);
      if (!stroked && !filled) continue;
      const data = (args?.[1] as ArrayLike<number>[] | undefined)?.[0];
      if (data == null) continue;
      const paths: Array<Array<[number, number]>> = [];
      let current: Array<[number, number]> | null = null;
      for (let k = 0; k < data.length; ) {
        const op = data[k++];
        if (op === 0) {
          current = [point(ctm, data[k++]!, data[k++]!)];
          paths.push(current);
        } else if (op === 1) {
          current?.push(point(ctm, data[k++]!, data[k++]!));
        } else if (op === 2) {
          k += 6;
          current = null;
        } else if (op === 3) {
          k += 4;
          current = null;
        } else if (op === 4) {
          if (current?.length) current.push(current[0]!);
        } else return null;
      }
      for (const pts of paths) {
        if (pts.length < 2) continue;
        const xs = pts.map((p) => p[0]);
        const ys = pts.map((p) => p[1]);
        const x1 = Math.min(...xs),
          x2 = Math.max(...xs),
          y1 = Math.min(...ys),
          y2 = Math.max(...ys);
        if (filled && !stroked) {
          if (x2 - x1 <= RULE && y2 - y1 > TOL) {
            if (!add(vertical, (x1 + x2) / 2, y1, y2)) return null;
          } else if (y2 - y1 <= RULE && x2 - x1 > TOL) {
            if (!add(horizontal, (y1 + y2) / 2, x1, x2)) return null;
          }
          continue;
        }
        for (let k = 1; k < pts.length; k++) {
          const [ax, ay] = pts[k - 1]!;
          const [bx, by] = pts[k]!;
          if (Math.abs(ay - by) < 0.5 && Math.abs(ax - bx) > TOL) {
            if (!add(horizontal, ay, ax, bx)) return null;
          } else if (Math.abs(ax - bx) < 0.5 && Math.abs(ay - by) > TOL) {
            if (!add(vertical, ax, ay, by)) return null;
          }
        }
      }
    }
  }
  return { horizontal, vertical };
}

function cluster(values: number[]): number[] {
  const groups: number[][] = [];
  for (const v of [...values].sort((a, b) => a - b)) {
    const last = groups.at(-1);
    if (last && v - last.at(-1)! <= TOL) last.push(v);
    else groups.push([v]);
  }
  return groups.map((g) => g.reduce((s, v) => s + v, 0) / g.length);
}
function covered(segments: Segment[], at: number, from: number, to: number) {
  const spans = segments
    .filter((s) => Math.abs(s.at - at) <= TOL)
    .sort((a, b) => a.from - b.from);
  let reach = from + TOL;
  for (const s of spans) {
    if (s.from - TOL > reach) break;
    reach = Math.max(reach, s.to);
  }
  return reach >= to - TOL;
}
type Frame = { xs: number[]; ys: number[]; rules: Rules };
function frames(rules: Rules): Frame[] {
  const all = [
    ...rules.horizontal.map((s) => ({ ...s, h: true })),
    ...rules.vertical.map((s) => ({ ...s, h: false })),
  ];
  const parent = all.map((_, i) => i);
  const find = (i: number): number =>
    parent[i] === i ? i : (parent[i] = find(parent[i]!));
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++) {
      const p = all[i]!,
        q = all[j]!;
      if (p.h === q.h) continue;
      const [h, v] = p.h ? [p, q] : [q, p];
      if (
        v.at >= h.from - TOL &&
        v.at <= h.to + TOL &&
        h.at >= v.from - TOL &&
        h.at <= v.to + TOL
      )
        parent[find(i)] = find(j);
    }
  const groups = new Map<number, typeof all>();
  all.forEach((s, i) => {
    const r = find(i);
    groups.set(r, [...(groups.get(r) ?? []), s]);
  });
  const out: Frame[] = [];
  for (const g of groups.values()) {
    const horizontal = g.filter((s) => s.h);
    const vertical = g.filter((s) => !s.h);
    const xs = cluster(vertical.map((s) => s.at));
    const ys = cluster(horizontal.map((s) => s.at)).reverse();
    if (xs.length < 3 || ys.length < 3) continue;
    out.push({ xs, ys, rules: { horizontal, vertical } });
  }
  return out.sort((a, b) => b.ys[0]! - a.ys[0]!);
}

// Approximate advance per character for locating words inside one run that
// crosses cell borders. Used only with a safety margin; failures fall back.
const advance = (ch: string) =>
  /\s/u.test(ch) ? 0.3 : /[ᄀ-ᇿ㄰-㆏가-힯　-鿿＀-￯]/u.test(ch) ? 1 : 0.55;

const numericLike = (text: string) =>
  /\d/u.test(text) &&
  /^[\s\d,.\-+()%/~:원인세천만억명호년개월㎡이하상초과미만]*$/u.test(
    text.replace(/\(\+\)|\(-\)/gu, ""),
  );

export function rebuildTable(
  frame: Frame,
  items: readonly PdfTextItem[],
): PdfTable | null {
  const { xs, ys } = frame;
  const R = ys.length - 1,
    C = xs.length - 1;
  if (R > PDF_TABLE_LIMITS.rows || C > PDF_TABLE_LIMITS.columns) return null;
  const id = (r: number, c: number) => r * C + c;
  const parent = Array.from({ length: R * C }, (_, i) => i);
  const find = (i: number): number =>
    parent[i] === i ? i : (parent[i] = find(parent[i]!));
  for (let r = 0; r < R; r++)
    for (let c = 0; c < C; c++) {
      if (
        c + 1 < C &&
        !covered(frame.rules.vertical, xs[c + 1]!, ys[r + 1]!, ys[r]!)
      )
        parent[find(id(r, c))] = find(id(r, c + 1));
      if (
        r + 1 < R &&
        !covered(frame.rules.horizontal, ys[r + 1]!, xs[c]!, xs[c + 1]!)
      )
        parent[find(id(r, c))] = find(id(r + 1, c));
    }
  const byRoot = new Map<number, Cell>();
  for (let r = 0; r < R; r++)
    for (let c = 0; c < C; c++) {
      const root = find(id(r, c));
      const cell = byRoot.get(root) ?? {
        r0: r,
        r1: r,
        c0: c,
        c1: c,
        units: 0,
        words: [],
        text: "",
      };
      cell.r0 = Math.min(cell.r0, r);
      cell.r1 = Math.max(cell.r1, r);
      cell.c0 = Math.min(cell.c0, c);
      cell.c1 = Math.max(cell.c1, c);
      cell.units++;
      byRoot.set(root, cell);
    }
  const cells = [...byRoot.values()];
  // A merged region that is not a rectangle is not a cell we can name.
  if (cells.some((c) => c.units !== (c.r1 - c.r0 + 1) * (c.c1 - c.c0 + 1)))
    return null;
  const at = (r: number, c: number) => byRoot.get(find(id(r, c)))!;
  const column = (x: number) =>
    xs.findIndex((v, k) => k < C && x >= v && x < xs[k + 1]!);
  const row = (y: number) =>
    ys.findIndex((v, k) => k < R && y <= v && y > ys[k + 1]!);
  const used: number[] = [];
  for (const item of items) {
    const text = item.str;
    if (!finite(item.x, item.y, item.width, item.height)) continue;
    if (!text.trim()) {
      // Spacing runs inside the frame belong to the table, not the page flow.
      if (
        item.x >= xs[0]! - TOL &&
        item.x <= xs[C]! + TOL &&
        item.y <= ys[0]! + TOL &&
        item.y >= ys[R]! - TOL
      )
        used.push(item.index);
      continue;
    }
    const h = item.height > 0 ? item.height : 8;
    const cy = item.y + h * 0.35;
    const left = item.x,
      right = item.x + item.width;
    const inside =
      right > xs[0]! + TOL &&
      left < xs[C]! - TOL &&
      cy < ys[0]! - 0.5 &&
      cy > ys[R]! + 0.5;
    if (!inside) {
      // Text straddling the table edge is ambiguous.
      if (
        right > xs[0]! + TOL &&
        left < xs[C]! - TOL &&
        cy < ys[0]! + TOL &&
        cy > ys[R]! - TOL
      )
        return null;
      continue;
    }
    const r = row(cy);
    if (r < 0) return null;
    // Allow small glyph overhang past a rule before treating a run as crossing.
    const first = column(Math.min(left + 2, (left + right) / 2)),
      last = column(Math.max(right - 2, (left + right) / 2));
    if (first < 0 || last < 0) return null;
    const firstCell = at(r, first);
    const lastCell = at(r, last);
    if (firstCell === lastCell) {
      firstCell.words.push({ x: left, y: item.y, h, text });
    } else {
      // One run crossing borders: place each word by its estimated centre and
      // require a clear margin; otherwise do not reconstruct this table.
      const weights = Array.from(text).map(advance);
      const total = weights.reduce((s, w) => s + w, 0);
      const scale = item.width / total;
      let offset: number;
      const touched = new Set<Cell>();
      for (const match of text.matchAll(/\S+/gu)) {
        const before = Array.from(text.slice(0, match.index)).reduce(
          (s, ch) => s + advance(ch),
          0,
        );
        offset = before;
        const width = Array.from(match[0]).reduce(
          (s, ch) => s + advance(ch),
          0,
        );
        const from = left + offset * scale,
          to = left + (offset + width) * scale;
        const centre = (from + to) / 2;
        const c = column(centre);
        if (c < 0) return null;
        const margin = Math.min(centre - xs[c]!, xs[c + 1]! - centre);
        if (margin < 3) return null;
        const cell = at(r, c);
        cell.words.push({ x: from, y: item.y, h, text: match[0] });
        touched.add(cell);
      }
      const span = new Set<Cell>();
      for (let c = first; c <= last; c++) span.add(at(r, c));
      if ([...span].some((cell) => !touched.has(cell))) return null;
    }
    used.push(item.index);
  }
  if (!cells.some((c) => c.words.length)) return null;
  for (const cell of cells) {
    const lines: Array<{ y: number; words: Cell["words"] }> = [];
    for (const w of [...cell.words].sort((a, b) => b.y - a.y || a.x - b.x)) {
      const line = lines.find(
        (l) => Math.abs(l.y - w.y) <= Math.max(2, w.h * 0.4),
      );
      if (line) line.words.push(w);
      else lines.push({ y: w.y, words: [w] });
    }
    cell.text = lines
      .map((l) =>
        l.words
          .sort((a, b) => a.x - b.x)
          .map((w) => w.text)
          .join(" "),
      )
      .join(" ")
      .replace(/\s+/gu, " ")
      .trim();
  }
  const starting = (r: number) => cells.filter((c) => c.r0 === r && c.text);
  let header = -1;
  for (let r = 0; r < R; r++) {
    const s = starting(r);
    const numeric = s.filter((c) => numericLike(c.text)).length;
    if (numeric >= 2 && numeric * 2 >= s.length) {
      header = r;
      break;
    }
  }
  // Header rows extend down to every cell that starts in them.
  if (header > 0) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const cell of cells)
        if (cell.r0 < header && cell.r1 >= header) {
          header = cell.r1 + 1;
          changed = true;
        }
    }
  }
  const rowCells = (r: number) =>
    [...new Set(Array.from({ length: C }, (_, c) => at(r, c)))].filter(
      (c) => c.text,
    );
  if (header <= 0 || header > PDF_TABLE_LIMITS.headerRows || header >= R) {
    // No certain header: keep cell grouping only, row by row.
    const lines: string[] = [];
    for (let r = 0; r < R; r++) {
      const cs = rowCells(r).filter((c) => c.r0 === r);
      if (cs.length) lines.push(cs.map((c) => c.text).join(" | "));
    }
    return lines.length ? { itemIndexes: used, lines } : null;
  }
  const headerPath = (c0: number, c1: number) => [
    ...new Set(
      cells
        .filter((h) => h.r1 < header && h.text && h.c0 <= c1 && h.c1 >= c0)
        .sort((a, b) => a.r0 - b.r0 || a.c0 - b.c0)
        .map((h) => h.text),
    ),
  ];
  // Full header path: parent headers often carry the unit (e.g. 천원) and must
  // stay attached to every value they describe.
  // Neighbouring columns under the same parent header are written once per
  // row as "parent — leaf: value, leaf: value"; the parent keeps its unit.
  const lines: string[] = [];
  for (let r = header; r < R; r++) {
    const cs = rowCells(r);
    if (cs.length === 0) continue;
    const groups: Array<{ parent: string; parts: string[] }> = [];
    for (const c of cs) {
      const path = headerPath(c.c0, c.c1);
      const leaf = path.at(-1) ?? "";
      const parent = path.slice(0, -1).join(" > ");
      const part = leaf ? `${leaf}: ${c.text}` : c.text;
      const last = groups.at(-1);
      if (last && parent && last.parent === parent) last.parts.push(part);
      else groups.push({ parent, parts: [part] });
    }
    lines.push(
      groups
        .map((g) =>
          g.parent ? `${g.parent} — ${g.parts.join(", ")}` : g.parts[0]!,
        )
        .join(" | "),
    );
  }
  return lines.length ? { itemIndexes: used, lines } : null;
}

export function pdfTables(
  rules: Rules | null,
  items: readonly PdfTextItem[],
): PdfTable[] {
  if (rules == null) return [];
  const found: PdfTable[] = [];
  const taken = new Set<number>();
  for (const frame of frames(rules).slice(0, PDF_TABLE_LIMITS.tablesPerPage)) {
    const table = rebuildTable(
      frame,
      items.filter((i) => !taken.has(i.index)),
    );
    if (table == null) continue;
    table.itemIndexes.forEach((i) => taken.add(i));
    found.push(table);
  }
  return found;
}
