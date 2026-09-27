import type { Metadata } from "next";
import { DocumentationPage } from "../documentation-page";
export const metadata: Metadata = { title: "MCP tools" };
export default function Page() { return <DocumentationPage slug="mcp" />; }
