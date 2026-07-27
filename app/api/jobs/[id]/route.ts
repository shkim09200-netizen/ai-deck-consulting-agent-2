import { NextRequest, NextResponse } from "next/server";
import { getOrLoadJob, snapshot } from "@/lib/jobs";

export const runtime = "nodejs";

/** Fetch a job snapshot (with its result) — used to restore a project's latest deck. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await getOrLoadJob(id);
  if (!job) return NextResponse.json({ error: "결과를 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json(snapshot(job));
}
