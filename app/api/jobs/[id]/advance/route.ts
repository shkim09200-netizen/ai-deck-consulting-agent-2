import { NextRequest, NextResponse } from "next/server";
import { loadOrAdoptJob, advanceJob, type Job } from "@/lib/jobs";
import { hasApiKey } from "@engine/llm/client.js";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Advance a running generation by one bounded step. The client sends the job
 * state it is carrying in the body; if durable storage doesn't have the job
 * (fresh serverless instance / not-yet-consistent read) we adopt that copy, so
 * "job not found" can't happen. Returns the FULL updated job for the next step.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!hasApiKey()) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY 가 서버에 설정되지 않았습니다." }, { status: 400 });
  }
  const { id } = await params;
  let carried: Job | undefined;
  try {
    carried = (await req.json())?.job as Job | undefined;
  } catch {
    /* no/invalid body — rely on storage */
  }
  const job = await loadOrAdoptJob(id, carried);
  if (!job) return NextResponse.json({ status: "error", error: "job not found" }, { status: 404 });

  const advanced = await advanceJob(job);
  return NextResponse.json(advanced);
}
