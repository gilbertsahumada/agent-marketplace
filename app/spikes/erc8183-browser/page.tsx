import { notFound, redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function Erc8183BrowserSpikePage() {
  const featureEnabled = Reflect.get(process.env, "ERC8183_BROWSER_SPIKE_ENABLED") === "true";
  if (!featureEnabled) notFound();
  redirect("/demo/erc8183");
}
