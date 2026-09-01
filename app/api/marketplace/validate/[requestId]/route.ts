import { NextResponse } from "next/server";
import {
  CatalogValidationRequestError,
  getCatalogValidationStatus,
  readCatalogValidationRequestToken,
} from "@/src/business/composition";

function errorResponse(error: CatalogValidationRequestError): NextResponse {
  return NextResponse.json(
    { error: { code: error.code, message: error.message } },
    {
      status: error.httpStatus,
      headers: error.retryAfterSeconds === undefined
        ? { "cache-control": "no-store" }
        : { "cache-control": "no-store", "retry-after": String(error.retryAfterSeconds) },
    },
  );
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ requestId: string }> },
) {
  const { requestId } = await context.params;
  const token = readCatalogValidationRequestToken(requestId);
  if (!token) {
    return NextResponse.json(
      { error: { code: "CATALOG_VALIDATION_NOT_FOUND", message: "The validation request was not found" } },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  }
  try {
    const result = await getCatalogValidationStatus(token);
    return NextResponse.json({
      schemaVersion: 2,
      requestId,
      ...result,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof CatalogValidationRequestError) return errorResponse(error);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "The validation status could not be completed" } },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
