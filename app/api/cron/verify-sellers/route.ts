import { recordMainnetSellerObservation } from "@/src/business/composition";

export const dynamic = "force-dynamic";

function unauthorized(): Response {
  return new Response("Unauthorized", { status: 401 });
}

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return unauthorized();
  try {
    return Response.json(await recordMainnetSellerObservation.execute());
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Observation store is unavailable" },
      { status: 503 },
    );
  }
}
