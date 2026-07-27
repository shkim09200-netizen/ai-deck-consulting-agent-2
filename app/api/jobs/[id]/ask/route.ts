import { NextRequest, NextResponse } from "next/server";
import { getOrLoadJob } from "@/lib/jobs";
import { hasApiKey } from "@engine/llm/client.js";
import { askDeck, type AskTurn } from "@engine/llm/ask.js";
import { buildTracker } from "@engine/domain/flags.js";
import type { ScriptDoc, SkeletonDoc } from "@engine/domain/types.js";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Read-only Q&A about the current deck. Explains; never edits. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!hasApiKey()) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY 가 설정되지 않아 AI 챗봇을 사용할 수 없습니다." },
      { status: 400 },
    );
  }

  const { id } = await params;
  const job = await getOrLoadJob(id);
  if (!job || !job.result) {
    return NextResponse.json({ error: "결과를 찾을 수 없습니다." }, { status: 404 });
  }

  let body: { question?: string; script?: ScriptDoc; skeleton?: SkeletonDoc; history?: AskTurn[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 본문입니다." }, { status: 400 });
  }

  const question = (body.question ?? "").trim();
  if (!question) return NextResponse.json({ error: "질문을 입력하세요." }, { status: 400 });

  // Use the live (possibly edited) docs from the client; fall back to saved.
  const script = body.script ?? job.result.script;
  const skeleton = body.skeleton ?? job.result.skeleton;

  try {
    const answer = await askDeck({
      question,
      script,
      skeleton,
      gap: job.result.gap,
      review: job.result.review,
      tracker: buildTracker(script, skeleton),
      history: body.history,
    });
    return NextResponse.json({ answer });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
