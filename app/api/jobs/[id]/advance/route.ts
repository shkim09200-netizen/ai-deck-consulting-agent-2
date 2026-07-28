import { NextRequest, NextResponse } from "next/server";
import { getOrLoadJob, advanceJob, snapshot } from "@/lib/jobs";
import { hasApiKey } from "@engine/llm/client.js";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Advance a running generation by one bounded step (one chunk of LLM work).
 * The client calls this repeatedly until status is "done"/"error". Each call is
 * short enough to fit a serverless function's time limit.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!hasApiKey()) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY 가 서버에 설정되지 않았습니다." },
      { status: 400 },
    );
  }
  const { id } = await params;
  const job = await getOrLoadJob(id);
  if (!job) return NextResponse.json({ status: "error", error: "job not found" }, { status: 404 });

  const advanced = await advanceJob(job);
  return NextResponse.json(snapshot(advanced));
}
