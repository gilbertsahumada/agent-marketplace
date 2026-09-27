import type { Metadata } from "next";
import { DocumentationPage } from "./documentation-page";
export const metadata: Metadata = { title: "Start here" };
export default function Page() { return <DocumentationPage slug="overview" />; }
