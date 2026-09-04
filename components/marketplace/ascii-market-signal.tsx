import { AsciiImageSignal } from "./ascii-image-signal";

const protocolNodes = [
  ["ERC-8004", "identity"],
  ["ERC-8183", "escrow"],
  ["MARKETPLACE", "access"],
  ["PEOPLE / AGENTS", "exchange"],
] as const;

export function AsciiMarketSignal() {
  return (
    <div className="market-ascii-composition">
      <div className="market-ascii-logo-wrap">
        <AsciiImageSignal src="/logo/PNG/BNB Chain_Symbol_Yellow.png" />
        <span aria-hidden="true">BNB CHAIN / SIGNAL 56</span>
      </div>

      <div
        className="market-protocol-rail"
        aria-label="ERC-8004 identity enables ERC-8183 escrow, connected through the marketplace to people and agents"
        role="img"
      >
        {protocolNodes.map(([label, detail]) => (
          <span className={label === "MARKETPLACE" ? "is-marketplace" : undefined} key={label}>
            <strong>{label}</strong>
            <small>{detail}</small>
          </span>
        ))}
      </div>
    </div>
  );
}
