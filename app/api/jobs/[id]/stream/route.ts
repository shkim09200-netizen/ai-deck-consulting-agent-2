import { NextRequest, NextResponse } from "next/server";
import { getOrLoadJob, snapshot } from "@/lib/jobs";

export const runtime = "nodejs";

/**
 * Generation now runs synchronously inside POST /api/generate (serverless can't
 * keep fire-and-forget work alive), so live SSE progress is gone. This endpoint
 * is kept for compatibility and just returns the current stored snapshot.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await getOrLoadJob(id);
  if (!job) return NextResponse.json({ status: "error", error: "job not found" }, { status: 404 });
  return NextResponse.json(snapshot(job));
}
