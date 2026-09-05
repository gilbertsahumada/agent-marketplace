import { BNB_ASCII_MARK } from "./bnb-ascii-mark";

// Server-rendered: the mark is a module constant, so there is no placeholder
// swap after hydration. Each glyph is its own span so the hover glow in
// globals.css can light characters individually.
export function AsciiBnbMark({ lines = BNB_ASCII_MARK }: { lines?: readonly string[] }) {
  return (
    <div className="market-ascii-logo-field">
      <pre className="market-ascii-logo" aria-label="BNB Chain symbol rendered as ASCII" role="img">
        {lines.map((line, row) => (
          <span className="market-ascii-line" key={row}>
            {Array.from(line, (character, column) => character === " "
              ? " "
              : <span className="market-ascii-char" key={column}>{character}</span>)}
          </span>
        ))}
      </pre>
    </div>
  );
}
