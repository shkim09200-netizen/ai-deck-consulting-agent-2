import type Anthropic from "@anthropic-ai/sdk";
import { callTool, MODELS } from "./client.js";
import {
  companyInputJsonSchema, companyInputValidator,
  clarificationJsonSchema, clarificationValidator, type Clarifications,
  scriptJsonSchema, scriptValidator,
  skeletonJsonSchema, skeletonValidator, type SkeletonOutput,
  reviewJsonSchema, reviewValidator, type ReviewOutput,
} from "./schemas.js";
import { ingestionSystem, clarificationSystem, gapSystem, scriptSystem, skeletonSystem, reviewSystem } from "./prompts.js";
import {
  gapJsonSchema, gapValidator,
} from "./schemas.js";
import type { CompanyInput, ScriptDoc, SkeletonDoc, Slide, Flag, GapAnalysis, ChecklistItem, SlideStatus } from "../domain/types.js";
import { SECTION_LABEL } from "../domain/houseStyle.js";
import { extractConfirmFlags, extractNeedsInputFlags } from "../domain/flags.js";
import { loadScriptExemplars, type FewShotExample } from "../fewshot/loader.js";
import type { ParsedSource } from "../ingestion/parse.js";

/* ---------- Step 0: Ingestion (§5.1) ---------- */

export async function extractCompanyInput(sources: ParsedSource[], directives?: string): Promise<CompanyInput> {
  const textBlocks = sources
    .filter((s) => s.text)
    .map((s) => `### 소스: ${s.name} (${s.kind})\n${s.text}`)
    .join("\n\n");
  const content: Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam> = [
    { type: "text", text: textBlocks || "(텍스트 소스 없음)" },
  ];
  if (directives?.trim()) {
    content.push({ type: "text", text: `### 사용자 추가 지시\n${directives.trim()}` });
  }
  for (const s of sources) {
    if (s.image) {
      content.push({ type: "text", text: `이미지 소스: ${s.name}` });
      content.push({ type: "image", source: { type: "base64", media_type: s.image.mediaType, data: s.image.base64 } });
    }
  }
  const input = await callTool({
    model: MODELS.light,
    system: ingestionSystem(directives),
    messages: [{ role: "user", content }],
    toolName: "emit_company_input",
    toolDescription: "업로드 자료에서 추출한 구조화 회사 정보 패키지를 반환한다.",
    inputSchema: companyInputJsonSchema,
    validator: companyInputValidator,
    maxTokens: 8000,
  });
  // Safety net: PresentationMinutesSchema already coerces, but guard again in
  // case of any 0/absent value. Default to 5분.
  if (!input.meta.presentationMinutes || input.meta.presentationMinutes <= 0) {
    input.meta.presentationMinutes = 5;
  }
  return input;
}

/* ---------- Step 0.5: Clarifications (§5.2) ---------- */

export async function getClarifications(input: CompanyInput): Promise<Clarifications> {
  return callTool({
    model: MODELS.light,
    system: clarificationSystem(),
    messages: [{ role: "user", content: `회사 정보:\n${JSON.stringify(input, null, 2)}` }],
    toolName: "emit_clarifications",
    toolDescription: "임의로 채우면 안 되는 필수 누락 정보에 대한 질문 목록을 반환한다.",
    inputSchema: clarificationJsonSchema,
    validator: clarificationValidator,
    maxTokens: 1500,
  });
}

/* ---------- Step 0.7: Gap Analysis (§ consulting core) ---------- */

/**
 * Diagnose the uploaded materials against the SparkLabs standard: mark each
 * required element present/absent per section, judge coverage, flag weak logic
 * and ordering problems, and give actionable recommendations. This is the
 * agent's primary consulting deliverable — not slide-making.
 */
export async function analyzeGaps(input: CompanyInput, sources?: ParsedSource[]): Promise<GapAnalysis> {
  const rawDeck = (sources ?? [])
    .filter((s) => s.text)
    .map((s) => `### ${s.name}\n${s.text.slice(0, 4000)}`)
    .join("\n\n")
    .slice(0, 12000);

  const out = await callTool({
    model: MODELS.generate,
    system: gapSystem(),
    messages: [
      {
        role: "user",
        content: `아래는 스타트업이 제출한 자료에서 추출한 구조화 정보와 원본 텍스트다. SparkLabs 기준으로 진단하라.\n\n[구조화 정보]\n${JSON.stringify(input, null, 2)}\n\n[원본 자료 발췌]\n${rawDeck || "(원본 텍스트 없음)"}`,
      },
    ],
    toolName: "emit_gap_analysis",
    toolDescription: "기존 자료를 SparkLabs 기준과 비교한 gap 분석 결과를 반환한다.",
    inputSchema: gapJsonSchema,
    validator: gapValidator,
    maxTokens: 8000,
  });

  return {
    storyline: out.storyline,
    orderIssues: out.orderIssues,
    missingSections: out.missingSections,
    sections: out.sections.map((s) => ({
      sectionKey: s.sectionKey,
      title: SECTION_LABEL[s.sectionKey] ?? s.sectionKey,
      coverage: s.coverage,
      items: s.items.map((it) => ({ label: it.label, done: it.present, note: it.note })),
      weakness: s.weakness,
      recommendation: s.recommendation,
    })),
  };
}

/** Build a compact text summary of the gap analysis for downstream prompts. */
export function gapSummaryText(gap: GapAnalysis): string {
  const lines: string[] = [];
  if (gap.missingSections.length) lines.push(`통째로 빠진 섹션: ${gap.missingSections.join(", ")}`);
  for (const s of gap.sections) {
    const missing = s.items.filter((i) => !i.done).map((i) => i.label);
    if (s.coverage !== "present" || missing.length) {
      lines.push(`- ${s.title} [${s.coverage}]${missing.length ? ` 부족: ${missing.join(", ")}` : ""}${s.recommendation ? ` → ${s.recommendation}` : ""}`);
    }
  }
  return lines.join("\n");
}

/* ---------- Step 1: Script (§4.1) ---------- */

export async function generateScript(
  input: CompanyInput,
  opts?: { exemplars?: FewShotExample[]; sectorGuide?: string; directives?: string },
): Promise<ScriptDoc> {
  const exemplars = opts?.exemplars ?? (await loadScriptExemplars());
  const raw = await callTool({
    model: MODELS.generate,
    system: scriptSystem({ exemplars, sectorGuide: opts?.sectorGuide, directives: opts?.directives, presentationMinutes: input.meta.presentationMinutes }),
    messages: [{ role: "user", content: `아래 회사 정보로 발표 스크립트를 작성하라.\n\n${JSON.stringify(input, null, 2)}` }],
    toolName: "emit_script",
    toolDescription: "섹션·beats 구조의 발표 스크립트를 반환한다.",
    inputSchema: scriptJsonSchema,
    validator: scriptValidator,
    maxTokens: 12000,
  });

  return finalizeScript(raw.sections, input.companyName, input.meta.presentationMinutes);
}

/**
 * Renumber sections 1..N and (re)collect inline [CONFIRM] flags.
 * Shared by initial generation and the edit path so flags stay consistent.
 */
export function finalizeScript(
  rawSections: Array<{ key: string; title: string; beats: Array<{ text: string; click: boolean }> }>,
  companyName: string,
  presentationMinutes: number,
): ScriptDoc {
  const sections = rawSections.map((s, i) => ({ ...s, no: i + 1 }));
  const flags: Flag[] = sections.flatMap((s) =>
    s.beats.flatMap((b) => extractConfirmFlags(b.text, `Script §${s.no} (${s.title})`)),
  );
  return { companyName, presentationMinutes, sections, flags };
}

/**
 * Re-key the script to the finished slides so the two match 1:1: one numbered
 * entry per slide (using that slide's speakerNotes), instead of section blocks
 * split by ambiguous `(click)` marks. The numbers in the script == slide numbers.
 */
export function alignScriptToSlides(skeleton: SkeletonDoc, companyName: string, presentationMinutes: number): ScriptDoc {
  const sections = skeleton.slides.map((sl) => ({
    no: sl.no,
    key: sl.sectionKey,
    title: (sl.eyebrow || sl.headline || sl.sectionKey || `Slide ${sl.no}`).trim(),
    beats: sl.speakerNotes?.trim() ? [{ text: sl.speakerNotes.trim(), click: false }] : [],
  }));
  const flags: Flag[] = sections.flatMap((s) =>
    s.beats.flatMap((b) => extractConfirmFlags(b.text, `슬라이드 ${s.no} (${s.title})`)),
  );
  return { companyName, presentationMinutes, sections, flags };
}

/* ---------- Step 2: Skeleton (§4.2) — only after Script approval ---------- */

export async function generateSkeleton(
  input: CompanyInput,
  script: ScriptDoc,
  opts?: { sectorGuide?: string; directives?: string; gap?: GapAnalysis },
): Promise<SkeletonDoc> {
  const scriptText = script.sections
    .map((s) => `(${s.title}) [§${s.no}]\n${s.beats.map((b) => b.text + (b.click ? " (click)" : "")).join("\n")}`)
    .join("\n\n");

  const gapBlock = opts?.gap
    ? `\n\n[Gap 분석 — 부족한 자료는 슬라이드에서 [NEEDS INPUT: ...]로 명확히 표시하고, 필요한 데이터 자리(예: TAM/SAM/SOM 차트)는 placeholder로 잡아라]\n${gapSummaryText(opts.gap)}`
    : "";

  const raw = await callTool({
    model: MODELS.generate,
    system: skeletonSystem({ sectorGuide: opts?.sectorGuide, directives: opts?.directives }),
    messages: [{ role: "user", content: `승인된 스크립트:\n\n${scriptText}\n\n회사 정보(트랙션/자료 유무 참고):\n${JSON.stringify(input, null, 2)}${gapBlock}` }],
    toolName: "emit_skeleton",
    toolDescription: "레이아웃 기반 슬라이드 설계(near-final)를 반환한다.",
    inputSchema: skeletonJsonSchema,
    validator: skeletonValidator,
    maxTokens: 28000,
  });

  return finalizeSkeleton(raw.slides, input, raw.accentColor, opts?.gap);
}

/**
 * Renumber slides 1..N, derive flags (inline [NEEDS INPUT], unconfirmed charts,
 * missing assets) AND attach the consulting layer: per-slide checklist + status
 * + gapNote from the Gap Analysis. Shared by generation and editing (pass the
 * stored gap so checklists survive edits).
 */
export function finalizeSkeleton(
  rawSlides: SkeletonOutput["slides"],
  input: CompanyInput,
  accentColor?: string,
  gap?: GapAnalysis,
  variant?: string,
): SkeletonDoc {
  const gapMap = new Map<string, GapAnalysis["sections"][number]>();
  for (const s of gap?.sections ?? []) if (!gapMap.has(s.sectionKey)) gapMap.set(s.sectionKey, s);
  const checklistShown = new Set<string>();

  const slides: Slide[] = rawSlides.map((sl, i) => {
    const no = i + 1;
    const loc = `Slide ${no}`;
    const inlineFlags: Flag[] = [
      ...extractNeedsInputFlags(sl.memo, loc),
      ...extractNeedsInputFlags(sl.visual?.direction ?? "", loc),
    ];
    if (sl.visual?.needsAsset) {
      inlineFlags.push({ kind: "NEEDS_INPUT", docType: "skeleton", locationRef: loc, message: `실제 자료 필요: ${sl.visual.direction || sl.visual.kind}` });
    }
    if (sl.chart && !sl.chart.confirmed) {
      inlineFlags.push({ kind: "NEEDS_INPUT", docType: "skeleton", locationRef: loc, message: `차트 수치 미확인: ${sl.chart.title || sl.headline || "차트"} — 자료 근거 필요` });
    }

    // consulting layer from Gap Analysis
    const gapEntry = gapMap.get(sl.sectionKey);
    const firstOfSection = gapEntry && !checklistShown.has(sl.sectionKey);
    if (gapEntry) checklistShown.add(sl.sectionKey);

    const checklist: ChecklistItem[] = firstOfSection ? gapEntry!.items.map((it) => ({ ...it })) : [];
    const missingItems = (gapEntry?.items ?? []).filter((it) => !it.done);
    const status: SlideStatus = gapEntry
      ? gapEntry.coverage === "missing"
        ? "missing"
        : gapEntry.coverage === "partial" || missingItems.length > 0
          ? "needs_input"
          : gapEntry.recommendation
            ? "recommend"
            : "ok"
      : "ok";
    const gapNote = gapEntry?.recommendation || undefined;

    // surface missing checklist items as tracker flags (once per section)
    const checklistFlags: Flag[] = firstOfSection
      ? missingItems.map((it) => ({ kind: "NEEDS_INPUT" as const, docType: "skeleton" as const, locationRef: loc, message: `${gapEntry!.title}: ${it.label}` }))
      : [];

    return {
      no,
      sectionKey: sl.sectionKey,
      layout: sl.layout,
      eyebrow: sl.eyebrow,
      headline: sl.headline,
      subhead: sl.subhead,
      bullets: sl.bullets,
      metrics: sl.metrics,
      columns: sl.columns,
      steps: sl.steps,
      team: sl.team,
      chart: sl.chart,
      visual: sl.visual,
      memo: sl.memo,
      speakerNotes: sl.speakerNotes,
      scriptRefs: sl.scriptRefs,
      flags: dedupeFlags([...inlineFlags, ...checklistFlags]),
      status,
      checklist,
      gapNote,
      offsets: sl.offsets,
    };
  });

  const flags = slides.flatMap((s) => s.flags);
  return {
    companyName: input.companyName,
    presentationMinutes: input.meta.presentationMinutes,
    accentColor,
    slides,
    flags,
    variant: variant ?? "minimal",
  };
}

function dedupeFlags(flags: Flag[]): Flag[] {
  const seen = new Set<string>();
  return flags.filter((f) => {
    const k = `${f.kind}|${f.locationRef}|${f.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** One-line textual summary of a slide's on-screen content (for review/prompts). */
export function summarizeSlide(sl: Slide): string {
  const parts: string[] = [];
  if (sl.headline) parts.push(sl.headline);
  if (sl.subhead) parts.push(sl.subhead);
  if (sl.bullets.length) parts.push(sl.bullets.map((b) => b.text).join(" · "));
  if (sl.metrics.length) parts.push(sl.metrics.map((m) => `${m.value} ${m.label}`).join(" · "));
  if (sl.columns.length) parts.push(sl.columns.map((c) => `${c.heading}: ${c.items.join(", ")}`).join(" | "));
  if (sl.steps.length) parts.push(sl.steps.map((s) => s.title).join(" → "));
  if (sl.team.length) parts.push(sl.team.map((t) => `${t.name}${t.role ? `(${t.role})` : ""}`).join(", "));
  if (sl.chart) parts.push(`[chart:${sl.chart.type} ${sl.chart.title ?? ""}${sl.chart.confirmed ? "" : " ⚠미확인"}]`);
  return parts.join(" — ") || "(내용 없음)";
}

/* ---------- AI Review (§8-5) ---------- */

export async function reviewDeck(script: ScriptDoc, skeleton?: SkeletonDoc): Promise<ReviewOutput> {
  const scriptText = script.sections
    .map((s) => `(${s.title}) [§${s.no}]\n${s.beats.map((b) => b.text).join("\n")}`)
    .join("\n\n");
  const skeletonText = skeleton
    ? skeleton.slides.map((sl) => `Slide ${sl.no} [${sl.layout}] (${sl.sectionKey}): ${summarizeSlide(sl)}`).join("\n")
    : "(스켈레톤 없음)";
  return callTool({
    // review is analytical, not creative — the light model is plenty and far
    // faster, keeping it off the critical path's tail.
    model: MODELS.light,
    system: reviewSystem(),
    messages: [{ role: "user", content: `[스크립트]\n${scriptText}\n\n[스켈레톤]\n${skeletonText}` }],
    toolName: "emit_review",
    toolDescription: "검토 발견 사항을 중요도별로 반환한다.",
    inputSchema: reviewJsonSchema,
    validator: reviewValidator,
    // rubric-grounded review surfaces more, longer findings — headroom so it
    // isn't truncated at max_tokens.
    maxTokens: 6000,
  });
}
