import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { storage } from "@/lib/storage";

export const runtime = "nodejs";

/**
 * Hand the browser a presigned URL to PUT a large file straight to object
 * storage (R2), bypassing the serverless 4.5MB request-body limit. The client
 * then sends only the returned `key` to /api/generate. If the backend can't
 * presign (filesystem/Blob), `url` is null and the client sends the file inline.
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
  const url = await storage.presignPut(key, contentType);
  return NextResponse.json({ key, url });
}
