import { handleHostedSellerMessage } from "@/src/business/hosted-seller-composition";
import {
  hostedSellerErrorResponse,
  hostedSellerRpcResult,
  parseHostedSellerRequest,
} from "@/src/presentation/http/hosted-seller-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let id: unknown = null;
  try {
    const parsed = await parseHostedSellerRequest(request);
    id = parsed.id;
    return hostedSellerRpcResult(
      id,
      await handleHostedSellerMessage.execute(parsed.message),
    );
  } catch (error) {
    console.error("[hosted-seller] A2A request failed");
    return hostedSellerErrorResponse(error, id);
  }
}
