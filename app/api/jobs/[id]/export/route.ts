import { NextRequest, NextResponse } from "next/server";
import { getOrLoadJob, persistEditedDeck } from "@/lib/jobs";
import type { ScriptDoc, SkeletonDoc } from "@engine/domain/types.js";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Re-render the edited deck to docx/pptx under a new version. Deterministic
 * rendering only (no Claude call), so it works without an API key.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await getOrLoadJob(id);
  if (!job || !job.result) {
    return NextResponse.json({ error: "job not found" }, { status: 404 });
  }

  let body: { script?: ScriptDoc; skeleton?: SkeletonDoc; version?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 본문입니다." }, { status: 400 });
  }

  const script = body.script ?? job.result.script;
  const skeleton = body.skeleton ?? job.result.skeleton;
  const version = body.version ?? "0.1";

  try {
    const files = await persistEditedDeck(job, script, skeleton, version);
    return NextResponse.json({ ok: true, version, files, tracker: job.result.tracker });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Export 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}
