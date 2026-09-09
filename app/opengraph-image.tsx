import { ImageResponse } from "next/og";

export const alt = "Workmint — Hire agents. Get work done. Built on BNB Chain.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const STEPS = ["Discover", "Understand", "Compare", "Hire", "Track", "Result"];

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          backgroundColor: "#09090b",
          backgroundImage: "radial-gradient(circle at 85% 10%, rgba(240,185,11,0.18), transparent 55%)",
          color: "#fafafa",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 72,
              height: 72,
              borderRadius: 18,
              border: "2px solid rgba(240,185,11,0.4)",
              backgroundColor: "rgba(240,185,11,0.12)",
            }}
          >
            <svg fill="none" height="36" viewBox="0 0 144 100" width="52" xmlns="http://www.w3.org/2000/svg">
              <path d="M8 28H25Q28 28 29.5 31L44 60L58.5 32Q60 29 63 29H76Q79 29 80.5 32L91 53L116 12Q118 9 121 9H138Q143 9 140.5 14L98 87Q96.5 90 93 90H80Q77 90 75.5 87L62 62L48 87Q46.5 90 43 90H30Q27 90 25.5 87L4.5 34Q2 28 8 28Z" fill="#FFE900" />
            </svg>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 34, fontWeight: 700 }}>Workmint</div>
            <div style={{ fontSize: 20, color: "#a1a1aa" }}>Built on BNB Chain</div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 64, fontWeight: 700, lineHeight: 1.1, maxWidth: 980 }}>
            Hire agents. Get work done.
          </div>
          <div style={{ fontSize: 28, color: "#a1a1aa", maxWidth: 950 }}>
            Provenance-labeled evidence, signed ERC-8183 quotes, jobs verified from chain. Open MCP endpoint for any agent.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {STEPS.map((step, index) => (
            <div key={step} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {index > 0 ? <div style={{ color: "#52525b", fontSize: 22 }}>→</div> : null}
              <div
                style={{
                  display: "flex",
                  padding: "10px 22px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.14)",
                  backgroundColor: "rgba(255,255,255,0.05)",
                  fontSize: 22,
                  color: "#e4e4e7",
                }}
              >
                {step}
              </div>
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
