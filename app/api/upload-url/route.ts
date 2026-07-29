import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { storage, storageProvider } from "@/lib/storage";

export const runtime = "nodejs";

/**
 * Tell the browser how to upload a large file directly (bypassing the 4.5MB
 * request-body limit), and under which storage key. The server later reads the
 * file back with storage.getBinary(key) — same key regardless of backend.
 *   - r2   → returns a presigned PUT url; client PUTs the file there
 *   - blob → client uploads via @vercel/blob/client to that key
 *   - none → client sends the file inline (dev / no object storage)
 */
export async function POST(req: NextRequest) {
  let body: { filename?: string; contentType?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  }
  const filename = (body.filename ?? "file").replace(/[^\w.\-가-힣]/g, "_").slice(0, 120) || "file";
  const contentType = body.contentType || "application/octet-stream";
  const key = `uploads/${randomUUID()}-${filename}`;

  // Both R2 and Blob now issue a presigned PUT url the browser uploads to
  // directly. null (filesystem) → the client sends the file inline instead.
  const url = await storage.presignPut(key, contentType);
  return NextResponse.json({ key, url, provider: storageProvider });
}
