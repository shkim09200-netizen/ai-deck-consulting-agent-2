import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Issues short-lived client tokens so the browser can upload files DIRECTLY to
 * Vercel Blob, bypassing the serverless function's 4.5MB request-body limit.
 * The client then sends only the resulting Blob URL to /api/generate.
 *
 * Requires BLOB_READ_WRITE_TOKEN (auto-set when a Vercel Blob store is linked).
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        // allow the document/image formats the parser understands (~any file)
        maximumSizeInBytes: 100 * 1024 * 1024, // 100MB — plenty for IR decks
        addRandomSuffix: true,
      }),
      onUploadCompleted: async () => {
        // no-op: the client receives the URL directly from upload()'s response.
      },
    });
    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "upload token failed" },
      { status: 400 },
    );
  }
}
