import type { ReactNode } from "react";

const JSON_TOKEN = /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?)|\b(true|false|null)\b/g;

export function highlightJson(code: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  for (const match of code.matchAll(JSON_TOKEN)) {
    const index = match.index ?? 0;
    if (index > cursor) nodes.push(<span className="text-zinc-500" key={key++}>{code.slice(cursor, index)}</span>);
    const [, string, colon, number, keyword] = match;
    if (string !== undefined) {
      nodes.push(
        <span className={colon ? "text-sky-300" : "text-emerald-300/90"} key={key++}>{string}</span>,
      );
      if (colon) nodes.push(<span className="text-zinc-500" key={key++}>{colon}</span>);
    } else if (number !== undefined) {
      nodes.push(<span className="text-amber-300" key={key++}>{number}</span>);
    } else if (keyword !== undefined) {
      nodes.push(<span className="text-fuchsia-300/90" key={key++}>{keyword}</span>);
    }
    cursor = index + match[0].length;
  }
  if (cursor < code.length) nodes.push(<span className="text-zinc-500" key={key++}>{code.slice(cursor)}</span>);
  return nodes;
}
