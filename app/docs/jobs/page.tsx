import type { Metadata } from "next";
import { DocumentationPage } from "../documentation-page";
export const metadata: Metadata = { title: "Read ERC-8183 jobs" };
export default function JobsDocs() { return <DocumentationPage slug="jobs" />; }
