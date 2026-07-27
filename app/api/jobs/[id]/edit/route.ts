import { NextRequest, NextResponse } from "next/server";
import { getOrLoadJob } from "@/lib/jobs";
import { hasApiKey } from "@engine/llm/client.js";
import { editDeck, type EditTurn } from "@engine/llm/edit.js";
import type { ScriptDoc, SkeletonDoc } from "@engine/domain/types.js";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!hasApiKey()) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY 가 설정되지 않아 AI 편집을 사용할 수 없습니다. 인라인 편집과 저장/다운로드는 그대로 사용 가능합니다." },
      { status: 400 },
    );
  }

  const { id } = await params;
  const job = await getOrLoadJob(id);
  if (!job || !job.result) {
    return NextResponse.json({ error: "job not found" }, { status: 404 });
  }

  let body: { instruction?: string; script?: ScriptDoc; skeleton?: SkeletonDoc; history?: EditTurn[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 본문입니다." }, { status: 400 });
  }

  const instruction = (body.instruction ?? "").trim();
  if (!instruction) {
    return NextResponse.json({ error: "수정 요청 내용이 비어 있습니다." }, { status: 400 });
  }

  // client is the source of truth for the current draft; fall back to job state
  const script = body.script ?? job.result.script;
  const skeleton = body.skeleton ?? job.result.skeleton;

  try {
    const out = await editDeck({ instruction, input: job.result.input, script, skeleton, gap: job.result.gap, history: body.history });
    return NextResponse.json(out);
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    // truncation on very large decks — give an actionable Korean message
    const friendly = /max_tokens|truncat/i.test(raw)
      ? "덱이 커서 한 번에 편집하기엔 응답 한도를 넘었습니다. 요청을 더 작게 나눠(예: 특정 슬라이드 하나만) 다시 시도해 주세요."
      : raw;
    return NextResponse.json({ error: friendly }, { status: 500 });
  }
}
