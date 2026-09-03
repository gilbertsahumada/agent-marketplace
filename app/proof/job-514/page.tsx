import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Public proof · Job 514" };

export default function Job514ProofPage() {
  permanentRedirect("/jobs/514");
}
