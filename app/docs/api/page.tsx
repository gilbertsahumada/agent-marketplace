import type { Metadata } from "next";
import { DocumentationPage } from "../documentation-page";
export const metadata: Metadata = { title: "HTTP API" };
export default function Page() { return <DocumentationPage slug="api" />; }
