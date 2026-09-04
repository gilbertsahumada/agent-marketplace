"use client";

import { useEffect, useState } from "react";

const RAMP = " .·:+*#";
const FALLBACK = [
  "           +++           ",
  "       +++     +++       ",
  "    +++    +++    +++    ",
  "  ++    +++   +++    ++  ",
  "    +++    +++    +++    ",
  "       +++     +++       ",
  "           +++           ",
].join("\n");

function rasterize(image: HTMLImageElement, columns: number): string {
  const rows = Math.max(12, Math.round(columns * 0.48));
  const canvas = document.createElement("canvas");
  canvas.width = columns;
  canvas.height = rows;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return FALLBACK;

  context.clearRect(0, 0, columns, rows);
  context.drawImage(image, 0, 0, columns, rows);
  const pixels = context.getImageData(0, 0, columns, rows).data;
  const lines: string[] = [];

  for (let y = 0; y < rows; y += 1) {
    let line = "";
    for (let x = 0; x < columns; x += 1) {
      const offset = (y * columns + x) * 4;
      const alpha = (pixels[offset + 3] ?? 0) / 255;
      if (alpha < 0.08) {
        line += " ";
        continue;
      }
      const dither = (x + y * 2) % 5 === 0 ? 0.62 : 0.86;
      const density = Math.min(1, alpha * dither);
      line += RAMP[Math.round(density * (RAMP.length - 1))];
    }
    lines.push(line.trimEnd());
  }

  return lines.join("\n");
}

export function AsciiImageSignal({ src }: { src: string }) {
  const [ascii, setAscii] = useState(FALLBACK);

  useEffect(() => {
    const image = new Image();
    let active = true;
    image.onload = () => {
      if (active) setAscii(rasterize(image, 42));
    };
    image.src = encodeURI(src);
    return () => {
      active = false;
    };
  }, [src]);

  return (
    <div className="market-ascii-logo-field">
      <pre className="market-ascii-logo" aria-label="BNB Chain logo converted from its source image into interactive ASCII" role="img">
        {ascii.split("\n").map((line, row) => (
          <span className="market-ascii-line" key={`${row}-${line}`}>
            {line.split("").map((character, column) => character === " "
              ? " "
              : <span className="market-ascii-char" key={`${row}-${column}`}>{character}</span>)}
          </span>
        ))}
      </pre>
    </div>
  );
}
