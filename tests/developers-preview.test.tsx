// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DocsShell } from "../app/docs/docs-shell";
import { RequestExample } from "../app/docs/request-example";
import { PrimaryNav } from "../components/marketplace/site-nav";
import { renderToStaticMarkup } from "react-dom/server";
import { highlightCode } from "../app/docs/highlight";
import { DOC_PAGES } from "../app/docs/content";
import { PageActions } from "../app/docs/page-actions";
const navigation = DOC_PAGES.map(({ title, href, group }) => ({ title, href, group }));
vi.mock("next/navigation", () => ({ usePathname: () => "/docs/api" }));
vi.mock("../components/marketplace/wallet-connect-button", () => ({ WalletConnectButton: () => <button>Connect wallet</button> }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const pages = [{ title: "HTTP API", href: "/docs/api", text: "jobs pagination chainId" }, { title: "MCP server", href: "/docs/mcp", text: "tools" }];
it("groups agent actions without hiding the primary Markdown copy action", async () => {
  render(<PageActions slug="jobs" markdown="# Jobs" />);
  expect(screen.getByRole("button", { name: "Copy Markdown" })).toBeVisible();
  expect(screen.queryByText("Open in Claude")).toBeNull();
  fireEvent.keyDown(screen.getByRole("button", { name: "Use with AI" }), { key: "Enter" });
  expect(await screen.findByRole("menuitem", { name: "View Markdown" })).toHaveAttribute("href", "/docs/md/jobs");
  expect(screen.getByRole("menuitem", { name: "Open in ChatGPT" })).toHaveAttribute("target", "_blank");
  fireEvent.keyDown(screen.getByRole("menuitem", { name: "Open in Claude" }), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
});
it("searches documentation locally and builds the article index", () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  render(<DocsShell searchPages={pages} navigation={navigation}><h1>HTTP API</h1><h2 id="jobs">Read jobs</h2></DocsShell>);
  expect(within(screen.getByRole("navigation", { name: "On this page" })).getByRole("link", { name: "Read jobs" })).toHaveAttribute("href", "#jobs");
  fireEvent.keyDown(document, { key: "k", ctrlKey: true });
  fireEvent.change(screen.getByRole("textbox", { name: "Search documentation" }), { target: { value: "pagination" } });
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByRole("link", { name: "HTTP API" })).toBeVisible();
  expect(within(dialog).queryByRole("link", { name: "MCP server" })).toBeNull();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "not-a-real-term" } });
  expect(screen.getByText(/No matching guide/)).toBeVisible();
  expect(fetch).not.toHaveBeenCalled();
});
it("offers mobile documentation navigation", () => {
  render(<DocsShell searchPages={pages} navigation={navigation}><h1>API</h1></DocsShell>);
  fireEvent.click(screen.getByRole("button", { name: "Guides" }));
  expect(within(screen.getByRole("dialog")).getByRole("link", { name: "Read ERC-8183 jobs" })).toHaveAttribute("href", "/docs/jobs");
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("link", { name: "HTTP API" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("switches code examples with keyboard and copies visible content", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  render(<RequestExample />);
  fireEvent.mouseDown(screen.getByRole("tab", { name: "JavaScript" }), { button: 0, ctrlKey: false });
  await waitFor(() => expect(screen.getByRole("tabpanel")).toHaveTextContent("const url"));
  fireEvent.click(screen.getByRole("button", { name: "Copy to clipboard" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining("nextBefore")));
});
it("links Developers directly to docs and escapes code", () => {
  render(<PrimaryNav />);
  expect(screen.getByRole("link", { name: "Developers" })).toHaveAttribute("href", "/docs");
  const html = renderToStaticMarkup(<code>{highlightCode('const text = "<script>";')}</code>);
  expect(html).toContain("docs-code-keyword"); expect(html).not.toContain("<script>");
});
it("opens Tools on click and closes with Escape", async () => {
  render(<PrimaryNav />);
  const trigger = screen.getByRole("button", { name: "Tools" });
  expect(trigger).toHaveAttribute("data-state", "closed");
  fireEvent.click(trigger);
  expect(trigger).toHaveAttribute("data-state", "open");
  for (const name of ["Ask", "Compare", "Validate"]) {
    expect(screen.getByRole("link", { name })).toBeVisible();
  }
  fireEvent.keyDown(screen.getByRole("link", { name: "Ask" }), { key: "Escape" });
  await waitFor(() => expect(trigger).toHaveAttribute("data-state", "closed"));
});
it("opens Tools with mouse hover", async () => {
  render(<PrimaryNav />);
  const trigger = screen.getByRole("button", { name: "Tools" });
  fireEvent.pointerEnter(trigger, { pointerType: "mouse" });
  fireEvent.pointerMove(trigger, { pointerType: "mouse" });
  await waitFor(() => expect(trigger).toHaveAttribute("data-state", "open"));
  expect(screen.getByRole("link", { name: "Compare" })).toHaveAttribute("href", "/compare");
});
