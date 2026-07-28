import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Token endpoint for the browser to upload a large file DIRECTLY to Vercel Blob
 * (bypassing the serverless 4.5MB request-body limit). `addRandomSuffix: false`
 * keeps the exact pathname (= the key the client was given) so the server can
 * later read it back via storage.getBinary(key). Requires BLOB_READ_WRITE_TOKEN.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        maximumSizeInBytes: 100 * 1024 * 1024, // 100MB
        addRandomSuffix: false,
        allowOverwrite: true,
      }),
      onUploadCompleted: async () => {
        /* no-op: the client references the file by its key */
      },
    });
    return NextResponse.json(json);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "upload token failed" },
      { status: 400 },
    );
  }
}
