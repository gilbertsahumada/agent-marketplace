import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const isConciergeConfigured = vi.hoisted(() => vi.fn());

vi.mock("@/src/business/composition", () => ({ isConciergeConfigured }));

vi.mock("@/components/marketplace/concierge-chat", () => ({
  ConciergeChat: (props: { initialPrompt?: string }) => <div data-testid="concierge-chat" data-prompt={props.initialPrompt ?? ""} />,
}));

const { default: AskPage } = await import("../app/ask/page.tsx");

async function render(searchParams: Record<string, string | string[]> = {}): Promise<string> {
  return renderToStaticMarkup(await AskPage({ searchParams: Promise.resolve(searchParams) }));
}

describe("/ask page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the concierge chat with the trimmed initial prompt when configured", async () => {
    isConciergeConfigured.mockReturnValue(true);

    const html = await render({ q: "grid" });

    expect(html).toContain("Say what you need");
    expect(html).toContain('data-testid="concierge-chat"');
    expect(html).toContain('data-prompt="grid"');
    expect(html).not.toContain("The concierge is not configured on this deployment.");
  });

  it("shows the unavailable notice when the concierge is not configured", async () => {
    isConciergeConfigured.mockReturnValue(false);

    const html = await render({ q: "grid" });

    expect(html).toContain("The concierge is not configured on this deployment.");
    expect(html).not.toContain('data-testid="concierge-chat"');
  });

  it("ignores a q supplied as an array and passes no initial prompt", async () => {
    isConciergeConfigured.mockReturnValue(true);

    const html = await render({ q: ["grid", "other"] });

    expect(html).toContain('data-testid="concierge-chat"');
    expect(html).toContain('data-prompt=""');
  });

  it("truncates an overlong q to 1200 characters", async () => {
    isConciergeConfigured.mockReturnValue(true);
    const long = "a".repeat(1300);

    const html = await render({ q: long });

    expect(html).toContain(`data-prompt="${"a".repeat(1200)}"`);
  });
});
