import { NextRequest, NextResponse } from "next/server";
import { getOrLoadJob, persistTranslatedDeck } from "@/lib/jobs";
import { hasApiKey } from "@engine/llm/client.js";
import { translateDeck } from "@engine/llm/translate.js";
import type { ScriptDoc, SkeletonDoc } from "@engine/domain/types.js";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Translate the CURRENT (possibly edited) deck to English, render EN docx/pptx,
 * and return the English script + skeleton for preview. Cached on the job until
 * the next call (which re-translates the latest content).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!hasApiKey()) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY 가 설정되지 않아 영어 번역을 사용할 수 없습니다." },
      { status: 400 },
    );
  }

  const { id } = await params;
  const job = await getOrLoadJob(id);
  if (!job || !job.result) {
    return NextResponse.json({ error: "job not found" }, { status: 404 });
  }

  let body: { script?: ScriptDoc; skeleton?: SkeletonDoc };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const script = body.script ?? job.result.script;
  const skeleton = body.skeleton ?? job.result.skeleton;

  try {
    const { script: scriptEn, skeleton: skeletonEn } = await translateDeck(script, skeleton, job.result.input);
    await persistTranslatedDeck(job, scriptEn, skeletonEn);
    return NextResponse.json({ script: scriptEn, skeleton: skeletonEn });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "영어 번역 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}
