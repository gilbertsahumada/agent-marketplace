"use client";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CodeBlock } from "./components";
export function RequestExample() {
  return <Tabs defaultValue="curl"><TabsList aria-label="Example language" variant="line"><TabsTrigger value="curl">cURL</TabsTrigger><TabsTrigger value="javascript">JavaScript</TabsTrigger></TabsList><TabsContent value="curl"><CodeBlock title="List indexed jobs" lang="shell">{`curl --fail-with-body \\
  "https://workmint.trust8004.xyz/api/marketplace/jobs?chainId=56"`}</CodeBlock></TabsContent><TabsContent value="javascript"><CodeBlock title="List indexed jobs" lang="javascript">{`const url = new URL(
  "/api/marketplace/jobs",
  "https://workmint.trust8004.xyz"
);
url.searchParams.set("chainId", "56");

const response = await fetch(url);
if (!response.ok) throw new Error("Jobs unavailable");
const { jobs, nextBefore } = await response.json();

// For the next page, keep your filters and set:
// url.searchParams.set("before", nextBefore);
// Stop when nextBefore is null.`}</CodeBlock></TabsContent></Tabs>;
}
