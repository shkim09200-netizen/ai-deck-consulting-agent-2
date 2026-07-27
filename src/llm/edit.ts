import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { callTool, MODELS } from "./client.js";
import {
  scriptJsonSchema,
  scriptValidator,
  skeletonJsonSchema,
  skeletonValidator,
} from "./schemas.js";
import { finalizeScript, finalizeSkeleton } from "./pipeline.js";
import type { CompanyInput, GapAnalysis, ScriptDoc, SkeletonDoc, Slide } from "../domain/types.js";

/* ---------- AI Editing Assistant (§6 Window 2) ---------- */

// reuse the exact section/slide shapes from the generation schemas so an edit
// round-trips through the same finalize/flag pipeline.
const sectionsSchema = (scriptJsonSchema.properties as Record<string, unknown>).sections;
const slidesSchema = (skeletonJsonSchema.properties as Record<string, unknown>).slides;

const editJsonSchema: Anthropic.Tool.InputSchema = {
  type: "object",
  properties: {
    summary: { type: "string", description: "무엇을 어떻게 바꿨는지 한국어 1~2문장" },
    accentColor: {
      type: "string",
      description:
        "덱 브랜드 액센트 색 '변경 요청'이 있을 때만 설정. 팔레트 키(indigo/blue/violet/teal/emerald/amber/rose/slate) 또는 6자리 hex. 변경 요청이 없으면 생략(기존 색 유지).",
    },
    sections: sectionsSchema as Anthropic.Tool.InputSchema,
    slides: slidesSchema as Anthropic.Tool.InputSchema,
    changedScriptSections: {
      type: "array",
      items: { type: "number" },
      description: "실제로 내용이 바뀐 스크립트 섹션 번호(수정 후 기준)",
    },
    changedSlides: {
      type: "array",
      items: { type: "number" },
      description: "실제로 내용이 바뀐 슬라이드 번호(수정 후 기준)",
    },
  },
  // sections + slides are ALWAYS required: an edit must return the full, mutually
  // consistent script AND skeleton — never just one side.
  required: ["summary", "sections", "slides"],
};

const editValidator = z.object({
  summary: z.string(),
  accentColor: z.string().optional(),
  sections: scriptValidator.shape.sections,
  slides: skeletonValidator.shape.slides,
  changedScriptSections: z.array(z.number()).default([]),
  changedSlides: z.array(z.number()).default([]),
});

function editSystem(): string {
  return [
    "너는 이미 생성된 발표 스크립트(대본)와 스켈레톤(슬라이드)을 사용자의 자연어 지시에 따라 수정하는 컨설턴트다.",
    "핵심 원칙 — 대본과 슬라이드는 한 몸이다. 절대 한쪽만 고치지 않는다:",
    "- 어떤 수정이든 스크립트와 스켈레톤 '둘 다'를 함께 반영해 서로 어긋나지 않게 한다.",
    "- 매 응답에서 sections(전체 섹션 배열)와 slides(전체 슬라이드 배열)를 '둘 다 항상' 반환한다. 한쪽 생략 금지.",
    "",
    "[양쪽 동기화 규칙 — 반드시 전파]",
    "- 수치/문구 변경: 스크립트 beat의 값을 바꾸면 그 내용을 담은 슬라이드의 headline/bullets/metrics/chart/onScreen/speakerNotes도 같은 값으로 바꾼다(그 반대도 동일).",
    "- 섹션 순서 변경: 스크립트 섹션 순서를 바꾸면 슬라이드 순서와 각 슬라이드의 scriptRefs도 맞춰 바꾼다.",
    "- 슬라이드 추가/분할/삭제: 슬라이드를 바꾸면 대응하는 스크립트 beats/(click)/구간도 함께 조정한다(그 반대도).",
    "- 톤/표현 변경: 요청한 톤을 스크립트 문장과 슬라이드 텍스트 양쪽에 동일하게 적용한다.",
    "- speakerNotes는 항상 해당 슬라이드에 매핑되는 스크립트 구간과 일치시킨다.",
    "",
    "[변경 최소화]",
    "- 지시에 필요한 부분 + 그 일관성 유지에 필요한 부분만 바꾸고, 나머지는 원문 그대로(글자까지 동일) 유지한다.",
    "- 반환 배열은 항상 '문서 전체'다(누락 방지). 실제로 바뀐 번호만 changedScriptSections/changedSlides에 적는다.",
    "",
    "[보존/품질]",
    "- 구어체 대본 톤과 (click) 마커 규칙 유지.",
    "- 슬라이드는 layout 아키타입과 구조화 필드(headline/eyebrow/bullets/metrics/columns/steps/team/chart/visual/memo)를 유지한 채 수정. 레이아웃 변경 요청이면 layout과 해당 필드를 함께 바꾼다.",
    "",
    "[요소 위치 이동 — offsets]",
    "- '지표 카드를 아래로', '차트를 오른쪽으로', '제목을 위로', '첫 번째 카드만 왼쪽으로' 처럼 특정 글씨/도형을 움직여 달라는 요청은 그 슬라이드의 offsets로 처리한다(내용은 그대로 두고 위치만 이동).",
    "- offsets는 요소별 {dx, dy}. dx=가로 %(양수 오른쪽/음수 왼쪽), dy=세로 %(양수 아래/음수 위), 범위 -60~60.",
    "- 요소 키: 제목영역 eyebrow/headline/subhead/accentRule/footer/badge, 본문 그룹 bullets/metrics/chart/visual/columns/steps/team, 그룹 내 특정 카드는 점표기(metrics.0=첫 지표카드, bullets.2=셋째 글머리, columns.1, steps.3, team.0). header는 제목영역 전체.",
    "- 모든 레이아웃(cover/statement/closing 포함)에서 동작한다.",
    "- 예: '슬라이드 3의 지표 카드를 아래로' → {\"metrics\":{\"dx\":0,\"dy\":14}}. '제목을 오른쪽으로' → {\"headline\":{\"dx\":12,\"dy\":0}}. '조금'이면 6~10, '많이'면 20~30 정도.",
    "- 상대 이동('더 아래로', '조금 왼쪽으로')은 현재 offsets 값에 더하거나 뺀다. 위치를 원래대로 요청하면 해당 키를 제거(또는 0)한다.",
    "- 이동 요청이 없으면 offsets는 건드리지 않는다(있던 값 유지).",
    "",
    "[테마 색상]",
    "- '액센트/포인트/테마 색을 ~로 바꿔줘' 요청이면 accentColor를 설정한다(팔레트 키 또는 hex). 색 변경 요청이 없으면 accentColor는 생략해 기존 색을 유지한다.",
    "- 차트 수치는 자료 근거가 있을 때만 confirmed=true. 지어내지 않는다.",
    "- 제공되지 않은 수치/주장은 창작 금지. 필요하면 스크립트는 [CONFIRM: ...], 슬라이드 memo는 [NEEDS INPUT: ...]로 표기한다.",
    "- summary는 사용자에게 보여줄 짧은 한국어 설명(스크립트·슬라이드에 각각 무엇을 반영했는지).",
    "",
    "[대화 맥락]",
    "- 이전 대화(있다면)는 참고 맥락이다. '현재 스크립트/스켈레톤'은 그 요청들이 이미 반영된 최신 상태다.",
    "- 이번에는 '[이번 수정 요청]'만 현재 문서에 적용한다. 과거 요청을 다시 적용하지 않는다.",
    "- 단 '방금 거 되돌려줘', '거기서 더 강조해줘'처럼 이전 턴을 가리키는 후속 요청은 대화 맥락으로 해석해 처리한다.",
  ].join("\n");
}

export interface EditResult {
  summary: string;
  script: ScriptDoc;
  skeleton: SkeletonDoc;
  changedScriptSections: number[];
  changedSlides: number[];
}

export interface EditTurn {
  role: "user" | "assistant";
  text: string;
}

/* ---------- Move fast-path (position-only edits) ----------
 * Moving an element is visual-only: it never touches the script and only sets
 * a slide's `offsets`. Routing it through the full editDeck (opus re-emitting
 * the whole 32k-token deck) is both slow (~3min) and error-prone. Instead we
 * detect movement instructions and handle them with a tiny sonnet call that
 * returns just the affected slides' offsets — near-instant and reliable. */

const DIR_RE = /(왼쪽|오른쪽|좌측|우측|위로|아래로|위쪽|아래쪽|올려|내려|가운데|중앙|왼편|오른편|우상|우하|좌상|좌하|left|right|\bup\b|\bdown\b)/i;
// strong content-change verbs → NOT a pure move, use the full path
const CONTENT_VERB_RE = /(바꿔|바꾸|변경|수정|추가|삭제|지워|없애|넣어|고쳐|합쳐|나눠|분리|번역|늘려|줄여|재작성|다시\s*써|강조해|색\s*을|컬러)/;

function isMoveInstruction(s: string): boolean {
  const t = s.trim();
  if (!t || t.length > 140) return false; // long → likely complex, take full path
  if (CONTENT_VERB_RE.test(t)) return false;
  return DIR_RE.test(t);
}

/** Element keys the model may target on a given slide (drives valid offsets). */
function slideElementKeys(sl: Slide): string[] {
  const k: string[] = ["headline"];
  if (sl.eyebrow) k.push("eyebrow");
  if (sl.subhead) k.push("subhead");
  k.push("accentRule");
  const grp = (name: string, n: number) => {
    if (n > 0) { k.push(name); for (let i = 0; i < n; i++) k.push(`${name}.${i}`); }
  };
  // card groups support per-card moves (separate shapes); bullets move as a group
  if (sl.bullets.length) k.push("bullets");
  grp("metrics", sl.metrics.length);
  grp("columns", sl.columns.length);
  grp("steps", sl.steps.length);
  grp("team", sl.team.length);
  if (sl.chart) k.push("chart");
  if (sl.visual.kind !== "none" || sl.visual.direction) k.push("visual");
  return k;
}

const moveJsonSchema: Anthropic.Tool.InputSchema = {
  type: "object",
  properties: {
    summary: { type: "string", description: "무엇을 어디로 옮겼는지 한국어 1문장" },
    slides: {
      type: "array",
      description: "위치가 바뀐 슬라이드만. offsets는 이동 후의 '전체' 오프셋(유지되는 키 포함).",
      items: {
        type: "object",
        properties: {
          no: { type: "number" },
          offsets: {
            type: "object",
            additionalProperties: { type: "object", properties: { dx: { type: "number" }, dy: { type: "number" } } },
          },
        },
        required: ["no", "offsets"],
      },
    },
  },
  required: ["summary", "slides"],
};

const moveValidator = z.object({
  summary: z.string().default("요소 위치를 이동했습니다."),
  slides: z
    .array(
      z.object({
        no: z.number(),
        offsets: z.record(z.string(), z.object({ dx: z.number().catch(0), dy: z.number().catch(0) })).default({}),
      }),
    )
    .default([]),
});

function moveSystem(): string {
  return [
    "너는 슬라이드 요소의 '위치만' 옮기는 도구다. 내용/문구/색/레이아웃/차트값은 절대 바꾸지 않는다.",
    "사용자의 이동 지시를 읽고, 대상 슬라이드의 offsets를 갱신해 반환한다.",
    "- offsets 키(요소): eyebrow/headline/subhead/accentRule/footer/badge, 본문 그룹 bullets/metrics/chart/visual/columns/steps/team, 그룹 내 특정 카드는 점표기(metrics.0=첫 지표카드, bullets.2=셋째 글머리, columns.1, steps.3, team.0). header=제목영역 전체.",
    "- dx=가로 %(양수 오른쪽/음수 왼쪽), dy=세로 %(양수 아래/음수 위), 범위 -60~60. '조금'=6~10, '많이'=20~30, 기본=12.",
    "- 상대 이동('더', '조금 더', '또')은 현재 offsets 값에 가감한다. '원래대로/제자리'는 해당 키를 0으로.",
    "- 반드시 이동 후의 '전체' offsets(그 슬라이드에서 유지되는 다른 키까지 포함)를 슬라이드별로 반환한다. 위치가 바뀐 슬라이드만 slides에 넣는다.",
    "- 대상 슬라이드는 사용자가 번호를 말하면 그 번호, 아니면 지시에 가장 맞는 슬라이드를 고른다. 각 슬라이드의 '사용 가능 요소'에 없는 키는 쓰지 않는다.",
  ].join("\n");
}

async function moveElements(
  instruction: string,
  skeleton: SkeletonDoc,
  history?: EditTurn[],
): Promise<{ summary: string; skeleton: SkeletonDoc; changedSlides: number[] } | null> {
  const inventory = skeleton.slides
    .map((sl) => {
      const cur = sl.offsets && Object.keys(sl.offsets).length ? ` 현재offsets=${JSON.stringify(sl.offsets)}` : "";
      return `Slide ${sl.no} [${sl.layout}] "${sl.headline || ""}" 사용가능요소: ${slideElementKeys(sl).join(", ")}${cur}`;
    })
    .join("\n");

  const prior: Anthropic.MessageParam[] = (history ?? []).slice(-4).map((h) => ({ role: h.role, content: h.text }));

  const out = await callTool({
    model: MODELS.light, // sonnet — small + fast
    system: moveSystem(),
    messages: [
      ...prior,
      { role: "user", content: `[이동 요청]\n${instruction}\n\n[슬라이드 목록]\n${inventory}` },
    ],
    toolName: "emit_move",
    toolDescription: "위치가 바뀐 슬라이드의 이동 후 전체 offsets를 반환한다.",
    inputSchema: moveJsonSchema,
    validator: moveValidator,
    maxTokens: 2000,
  });

  if (!out.slides.length) return null; // nothing moved → let caller fall back

  const cl = (v: number) => Math.max(-60, Math.min(60, Number(v) || 0));
  const changed: number[] = [];
  const slides = skeleton.slides.map((sl) => {
    const hit = out.slides.find((s) => s.no === sl.no);
    if (!hit) return sl;
    const clean: Record<string, { dx: number; dy: number }> = {};
    for (const [k, v] of Object.entries(hit.offsets)) {
      if (!v) continue;
      const dx = cl(v.dx), dy = cl(v.dy);
      if (dx !== 0 || dy !== 0) clean[k] = { dx, dy };
    }
    changed.push(sl.no);
    return { ...sl, offsets: Object.keys(clean).length ? clean : undefined };
  });

  return { summary: out.summary, skeleton: { ...skeleton, slides }, changedSlides: changed };
}

/**
 * Apply one natural-language edit instruction to the current deck and return
 * the updated (fully finalized) script + skeleton. Only the docs the model
 * chose to touch are regenerated; the other is passed through unchanged.
 */
export async function editDeck(args: {
  instruction: string;
  input: CompanyInput;
  script: ScriptDoc;
  skeleton: SkeletonDoc;
  gap?: GapAnalysis;
  /** prior edit-assistant turns, so follow-up requests ("방금 거 되돌려줘") have context */
  history?: EditTurn[];
}): Promise<EditResult> {
  const { instruction, input, script, skeleton, gap, history } = args;

  // Fast-path: pure position moves skip the full deck re-emit (opus, ~3min) and
  // just set offsets via a tiny sonnet call. Falls back to the full path if the
  // move model returns nothing or errors.
  if (isMoveInstruction(instruction)) {
    try {
      const moved = await moveElements(instruction, skeleton, history);
      if (moved) {
        return {
          summary: moved.summary,
          script, // unchanged — moving is visual-only
          skeleton: moved.skeleton,
          changedScriptSections: [],
          changedSlides: moved.changedSlides,
        };
      }
    } catch {
      /* fall through to the full edit path */
    }
  }

  const scriptJson = JSON.stringify(
    { sections: script.sections.map((s) => ({ no: s.no, key: s.key, title: s.title, beats: s.beats })) },
    null,
    2,
  );
  const skeletonJson = JSON.stringify(
    {
      accentColor: skeleton.accentColor,
      slides: skeleton.slides.map((sl) => ({
        no: sl.no,
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
        offsets: sl.offsets,
      })),
    },
    null,
    2,
  );

  const prior: Anthropic.MessageParam[] = (history ?? []).slice(-8).map((h) => ({
    role: h.role,
    content: h.text,
  }));

  const out = await callTool({
    model: MODELS.generate,
    system: editSystem(),
    messages: [
      ...prior,
      {
        role: "user",
        content: `[이번 수정 요청]\n${instruction}\n\n[현재 스크립트]\n${scriptJson}\n\n[현재 스켈레톤]\n${skeletonJson}`,
      },
    ],
    toolName: "emit_edit",
    toolDescription: "스크립트와 스켈레톤을 서로 일관되게 함께 수정한 전체 문서(둘 다)와 변경 요약을 반환한다.",
    inputSchema: editJsonSchema,
    validator: editValidator,
    // edits must re-emit the FULL script + skeleton every time, so headroom
    // scales with deck size — keep this generous to avoid truncation on big decks.
    maxTokens: 32000,
  });

  // Always re-finalize BOTH so the two documents stay consistent. Use a new
  // accent only if the edit explicitly changed it; otherwise keep the current.
  const newScript = finalizeScript(out.sections, script.companyName, script.presentationMinutes);
  const newSkeleton = finalizeSkeleton(out.slides, input, out.accentColor || skeleton.accentColor, gap, skeleton.variant);

  return {
    summary: out.summary,
    script: newScript,
    skeleton: newSkeleton,
    changedScriptSections: out.changedScriptSections,
    changedSlides: out.changedSlides,
  };
}
