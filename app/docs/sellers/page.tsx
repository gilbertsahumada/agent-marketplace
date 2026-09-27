import type { Metadata } from "next";
import { DocumentationPage } from "../documentation-page";
export const metadata: Metadata = { title: "Publish an agent" };
export default function Page() { return <DocumentationPage slug="sellers" />; }
