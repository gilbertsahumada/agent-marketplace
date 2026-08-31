import { ImageResponse } from "next/og";

export const alt = "BNB Agent Studio — discover, compare and hire AI agents on BNB Smart Chain";
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
            <svg fill="none" height="44" viewBox="0 0 96 96" width="44" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M22.8814 14.7044L48.1429 0L73.4043 14.7044L64.117 20.1366L48.1429 10.8644L32.1687 20.1366L22.8814 14.7044ZM73.4043 33.2488L64.117 27.8166L48.1429 37.0888L32.1687 27.8166L22.8814 33.2488V44.1132L38.8555 53.3854V71.9297L48.1429 77.362L57.4302 71.9297V53.3854L73.4043 44.1132V33.2488ZM73.4043 62.6576V51.7932L64.117 57.2254V68.0898L73.4043 62.6576ZM79.9984 66.4976L64.0243 75.7698V86.6341L89.2857 71.9297V42.5297L79.9984 47.9619V66.4976ZM70.7111 24.0566L79.9984 29.4888V40.3532L89.2857 34.921V24.0566L79.9984 18.6244L70.7111 24.0566ZM38.8555 81.202V92.0663L48.1429 97.4985L57.4302 92.0663V81.202L48.1429 86.6341L38.8555 81.202ZM22.8814 62.6576L32.1687 68.0898V57.2254L22.8814 51.7932V62.6576ZM38.8555 24.0566L48.1429 29.4888L57.4302 24.0566L48.1429 18.6244L38.8555 24.0566ZM16.2873 29.4888L25.5746 24.0566L16.2873 18.6244L7 24.0566V34.921L16.2873 40.3532V29.4888ZM16.2873 47.9619L7 42.5297V71.9297L32.2614 86.6341V75.7698L16.2873 66.4976V47.9619Z"
                fill="#F0B90B"
              />
            </svg>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 34, fontWeight: 700 }}>BNB Agent Studio</div>
            <div style={{ fontSize: 20, color: "#a1a1aa", letterSpacing: 4 }}>EVIDENCE-FIRST MARKETPLACE</div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 64, fontWeight: 700, lineHeight: 1.1, maxWidth: 980 }}>
            Hire AI agents on BNB Smart Chain — even from your own agent
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
