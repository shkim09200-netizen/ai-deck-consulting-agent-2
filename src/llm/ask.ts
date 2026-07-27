import { getClient, MODELS } from "./client.js";
import type { GapAnalysis, ScriptDoc, SkeletonDoc } from "../domain/types.js";
import type { TrackerItem } from "../domain/flags.js";

/* ---------- AI Q&A Assistant (read-only deck explainer) ---------- */

export interface AskTurn {
  role: "user" | "assistant";
  text: string;
}

export interface ReviewLike {
  severity: string;
  category: string;
  locationRef: string;
  message: string;
}

/** Compact, model-readable dump of the CURRENT deck so answers are grounded. */
function deckContext(
  script: ScriptDoc,
  skeleton: SkeletonDoc,
  gap?: GapAnalysis,
  tracker?: TrackerItem[],
  review?: ReviewLike[],
): string {
  const scriptStr = script.sections
    .map((s) => `§${s.no} (${s.title})\n` + s.beats.map((b) => `  - ${b.text}${b.click ? "  (click)" : ""}`).join("\n"))
    .join("\n");

  const slideStr = skeleton.slides
    .map((sl) => {
      const parts: string[] = [`Slide ${sl.no} · ${sl.sectionKey} · [${sl.layout}]`];
      if (sl.eyebrow) parts.push(`  eyebrow: ${sl.eyebrow}`);
      if (sl.headline) parts.push(`  headline: ${sl.headline}`);
      if (sl.subhead) parts.push(`  subhead: ${sl.subhead}`);
      if (sl.bullets?.length) parts.push(`  bullets: ${sl.bullets.map((b) => b.text).join(" | ")}`);
      if (sl.metrics?.length) parts.push(`  metrics: ${sl.metrics.map((m) => `${m.value} ${m.label}`).join(" | ")}`);
      if (sl.columns?.length) parts.push(`  columns: ${sl.columns.map((c) => c.heading).join(" vs ")}`);
      if (sl.steps?.length) parts.push(`  steps: ${sl.steps.map((s) => s.title).join(" → ")}`);
      if (sl.team?.length) parts.push(`  team: ${sl.team.map((t) => `${t.name}${t.role ? `(${t.role})` : ""}`).join(", ")}`);
      if (sl.chart) parts.push(`  chart: ${sl.chart.type} "${sl.chart.title ?? ""}"${sl.chart.confirmed ? "" : " (수치 미확인)"}`);
      if (sl.visual?.kind && sl.visual.kind !== "none") parts.push(`  visual: ${sl.visual.kind} — ${sl.visual.direction}`);
      if (sl.scriptRefs?.length) parts.push(`  대본연결: ${sl.scriptRefs.join(", ")}`);
      return parts.join("\n");
    })
    .join("\n");

  const blocks: string[] = [
    `[회사] ${script.companyName} · 발표 ${script.presentationMinutes}분 · 섹션 ${script.sections.length}개 · 슬라이드 ${skeleton.slides.length}장`,
    `\n[대본 Script]\n${scriptStr}`,
    `\n[슬라이드 Skeleton]\n${slideStr}`,
  ];
  if (gap && (gap.storyline || gap.missingSections.length || gap.orderIssues.length)) {
    blocks.push(
      `\n[Gap 진단]\n스토리라인: ${gap.storyline || "-"}\n누락 섹션: ${gap.missingSections.join(", ") || "없음"}\n순서 이슈: ${gap.orderIssues.join("; ") || "없음"}`,
    );
  }
  if (tracker?.length) {
    blocks.push(`\n[미해결 항목]\n` + tracker.map((t) => `  - [${t.kind}] ${t.locationRef}: ${t.message}`).join("\n"));
  }
  if (review?.length) {
    blocks.push(`\n[AI Review]\n` + review.map((r) => `  - (${r.severity}) ${r.category} @ ${r.locationRef}: ${r.message}`).join("\n"));
  }
  return blocks.join("\n");
}

function askSystem(): string {
  return [
    "너는 이미 생성된 발표 대본(Script)과 슬라이드 설계도(Skeleton)에 대해 사용자의 질문에 답하는 설명 도우미다.",
    "너의 역할은 '설명과 안내'다. 문서를 수정하지 않는다. 사용자가 수정을 원하면 바로 위의 'AI 편집 어시스턴트'를 쓰라고 안내한다.",
    "",
    "규칙:",
    "- 아래 제공된 '현재 덱' 내용에만 근거해 한국어로 정확하고 간결하게 답한다.",
    "- 슬라이드 구성/흐름을 물으면 섹션(§N)→슬라이드(Slide N) 순서와 각 슬라이드의 역할을 요약한다.",
    "- '어떤 정보가 어디 있는지' 물으면 해당 위치(Slide N 또는 §N)를 정확히 짚어준다. 없으면 '현재 덱에는 없다'고 답한다.",
    "- 덱에 없는 사실을 지어내지 않는다. 관련된 [CONFIRM]/[NEEDS INPUT]/미해결 항목/차트 미확인이 있으면 함께 알려준다.",
    "- 마크다운 강조 기호(**, ##) 없이 평문으로 답하되, 필요하면 짧은 글머리 목록을 쓴다.",
  ].join("\n");
}

/**
 * Answer a question about the current deck. Read-only — never mutates the docs.
 * Grounded in the script/skeleton (+ gap/tracker/review) passed in.
 */
export async function askDeck(args: {
  question: string;
  script: ScriptDoc;
  skeleton: SkeletonDoc;
  gap?: GapAnalysis;
  tracker?: TrackerItem[];
  review?: ReviewLike[];
  history?: AskTurn[];
}): Promise<string> {
  const client = getClient();
  const ctx = deckContext(args.script, args.skeleton, args.gap, args.tracker, args.review);

  const history = (args.history ?? []).slice(-6).map((h) => ({
    role: h.role,
    content: h.text,
  }));

  const res = await client.messages.create({
    model: MODELS.light,
    max_tokens: 1500,
    system: askSystem(),
    messages: [
      ...history,
      { role: "user", content: `[현재 덱]\n${ctx}\n\n[질문]\n${args.question}` },
    ],
  });

  const text = res.content
    .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  return text || "답변을 생성하지 못했습니다.";
}
