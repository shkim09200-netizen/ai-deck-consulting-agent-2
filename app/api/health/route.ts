import { NextResponse } from "next/server";
import { storageProvider } from "@/lib/storage";
import { hasApiKey } from "@engine/llm/client.js";

export const runtime = "nodejs";

/**
 * Diagnostic endpoint — visit /api/health to see exactly what is deployed and
 * configured. `version` proves which code is live; `storageProvider` shows
 * whether object storage (Blob/R2) is actually active (else large uploads and
 * durable storage won't work).
 */
export async function GET() {
  return NextResponse.json({
    version: "2026-07-29-officetext",
    storageProvider, // "r2" | "blob" | "fs" (fs = no object storage → big files & persistence won't work)
    hasApiKey: hasApiKey(),
    bigFileUpload: storageProvider !== "fs",
  });
}
