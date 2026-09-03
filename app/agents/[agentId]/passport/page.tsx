import { permanentRedirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function EvidencePassportPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId } = await params;
  permanentRedirect(`/hire/${agentId}`);
}
