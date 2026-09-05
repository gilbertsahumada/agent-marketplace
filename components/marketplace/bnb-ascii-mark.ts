// The BNB Chain symbol as ASCII, rasterized from the official SVG outline
// (public/logo/SVG/BNB Chain_Symbol_Yellow.svg, viewBox 0 0 96 96) with
// coverage supersampling. Pure math: it runs on the server at module load, so
// the hero renders the finished mark on first paint instead of swapping a
// placeholder for a canvas result after hydration.

const BNB_SYMBOL_PATH =
  "M22.8814 14.7044L48.1429 0L73.4043 14.7044L64.117 20.1366L48.1429 10.8644L32.1687 20.1366L22.8814 14.7044Z"
  + "M73.4043 33.2488L64.117 27.8166L48.1429 37.0888L32.1687 27.8166L22.8814 33.2488V44.1132L38.8555 53.3854V71.9297L48.1429 77.362L57.4302 71.9297V53.3854L73.4043 44.1132V33.2488Z"
  + "M73.4043 62.6576V51.7932L64.117 57.2254V68.0898L73.4043 62.6576Z"
  + "M79.9984 66.4976L64.0243 75.7698V86.6341L89.2857 71.9297V42.521L79.9984 47.9532V66.4976Z"
  + "M70.7111 23.9766L79.9984 29.4088V40.2732L89.2857 34.841V23.9766L79.9984 18.5444L70.7111 23.9766Z"
  + "M38.8555 79.7034V90.5678L48.1429 96L57.4302 90.5678V79.7034L48.1429 85.1356L38.8555 79.7034Z"
  + "M22.8814 62.6576L32.1687 68.0898V57.2254L22.8814 51.7932V62.6576Z"
  + "M38.8555 23.9766L48.1429 29.4088L57.4302 23.9766L48.1429 18.5444L38.8555 23.9766Z"
  + "M16.2873 29.4088L25.5746 23.9766L16.2873 18.5444L7 23.9766V34.841L16.2873 40.2732V29.4088Z"
  + "M16.2873 47.9532L7 42.521V71.9297L32.2615 86.6341V75.7698L16.2873 66.4976V47.9532Z";

// Symbol bounds inside the 96×96 viewBox; the outline is symmetric about
// x = 48.1429, so the rasterized mark comes out mirror-symmetric too.
const SYMBOL_BOUNDS = { left: 7, right: 89.2857, top: 0, bottom: 96 } as const;

type Point = readonly [number, number];

function parsePolygons(path: string): Point[][] {
  const polygons: Point[][] = [];
  let current: Point[] = [];
  let x = 0;
  let y = 0;
  const tokens = path.match(/[MLVHZ]|-?\d*\.?\d+/g) ?? [];
  let index = 0;
  const next = () => Number(tokens[index++]);

  while (index < tokens.length) {
    const token = tokens[index++];
    if (token === "M") {
      if (current.length > 0) polygons.push(current);
      current = [];
      x = next();
      y = next();
      current.push([x, y]);
    } else if (token === "L") {
      x = next();
      y = next();
      current.push([x, y]);
    } else if (token === "V") {
      y = next();
      current.push([x, y]);
    } else if (token === "H") {
      x = next();
      current.push([x, y]);
    } else if (token === "Z") {
      if (current.length > 0) polygons.push(current);
      current = [];
    } else {
      // Bare coordinate pair after L: an implicit line-to.
      x = Number(token);
      y = next();
      current.push([x, y]);
    }
  }
  if (current.length > 0) polygons.push(current);
  return polygons;
}

const POLYGONS = parsePolygons(BNB_SYMBOL_PATH);

// Even-odd point-in-polygon across every subpath, which is how the SVG
// renderer fills this outline (fill-rule defaults to nonzero, but no
// subpath here overlaps another, so both rules agree).
function covered(px: number, py: number): boolean {
  let inside = false;
  for (const polygon of POLYGONS) {
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
      const [xi, yi] = polygon[i]!;
      const [xj, yj] = polygon[j]!;
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

export interface AsciiMarkOptions {
  /** Character columns across the symbol. */
  columns: number;
  /** Character cell width divided by height; Space Mono at line-height 0.94 is ~0.65. */
  cellAspect?: number;
  /** Coverage ramp from empty to solid. */
  ramp?: string;
  /** Samples per cell edge; coverage is measured over supersample² points. */
  supersample?: number;
}

export function rasterizeAsciiMark({ columns, cellAspect = 0.65, ramp = " .:-=+*#", supersample = 6 }: AsciiMarkOptions): readonly string[] {
  const width = SYMBOL_BOUNDS.right - SYMBOL_BOUNDS.left;
  const height = SYMBOL_BOUNDS.bottom - SYMBOL_BOUNDS.top;
  const rows = Math.round(columns * cellAspect * (height / width));
  const lines: string[] = [];

  for (let row = 0; row < rows; row += 1) {
    let line = "";
    for (let column = 0; column < columns; column += 1) {
      let hits = 0;
      for (let a = 0; a < supersample; a += 1) {
        for (let b = 0; b < supersample; b += 1) {
          const px = SYMBOL_BOUNDS.left + ((column + (a + 0.5) / supersample) / columns) * width;
          const py = SYMBOL_BOUNDS.top + ((row + (b + 0.5) / supersample) / rows) * height;
          if (covered(px, py)) hits += 1;
        }
      }
      const coverage = hits / (supersample * supersample);
      line += ramp[Math.round(coverage * (ramp.length - 1))];
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

export const BNB_ASCII_MARK_COLUMNS = 44;

export const BNB_ASCII_MARK: readonly string[] = rasterizeAsciiMark({ columns: BNB_ASCII_MARK_COLUMNS });
