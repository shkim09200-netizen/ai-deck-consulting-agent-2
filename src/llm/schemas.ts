import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { CompanyInputSchema } from "../domain/types.js";

/**
 * Tolerate the model handing back a structured value as a JSON *string* — a
 * Sonnet quirk on complex tool inputs, sometimes re-wrapped as `{<key>: [...]}`.
 * Parse (and unwrap) so one formatting slip doesn't crash the whole generation.
 */
function jsonish<T extends z.ZodTypeAny>(inner: T, unwrapKey?: string) {
  return z.preprocess((v) => {
    if (typeof v !== "string") return v;
    try {
      const p: unknown = JSON.parse(v);
      if (
        unwrapKey &&
        p &&
        typeof p === "object" &&
        !Array.isArray(p) &&
        Array.isArray((p as Record<string, unknown>)[unwrapKey])
      ) {
        return (p as Record<string, unknown>)[unwrapKey];
      }
      return p;
    } catch {
      return v;
    }
  }, inner);
}

/* ---------- Ingestion: extract/merge CompanyInput ---------- */

export const companyInputJsonSchema: Anthropic.Tool.InputSchema = {
  type: "object",
  properties: {
    companyName: { type: "string" },
    oneLiner: { type: ["string", "null"] },
    sector: { type: ["string", "null"] },
    founderBackground: { type: ["string", "null"] },
    problem: { type: ["string", "null"], description: "창업자 원문 표현 최대한 보존" },
    existingAlternatives: { type: ["string", "null"] },
    ourSolution: { type: ["string", "null"] },
    differentiators: { type: ["string", "null"] },
    traction: {
      type: "object",
      properties: {
        quantitative: { type: "array", items: { type: "string" } },
        awards: { type: "array", items: { type: "string" } },
        partnerships: { type: "array", items: { type: "string" } },
        press: { type: "array", items: { type: "string" } },
      },
    },
    roadmap: { type: ["string", "null"] },
    freeformNotes: { type: ["string", "null"] },
    meta: {
      type: "object",
      properties: {
        vision: { type: ["string", "null"] },
        tone: { type: ["string", "null"] },
        keyInvestorMessage: { type: ["string", "null"] },
        presentationMinutes: { type: ["number", "null"], description: "발표 시간(분). 자료에 명시가 없으면 null. 미지정 시 기본 5분으로 처리됨." },
        mustInclude: { type: "array", items: { type: "string" } },
      },
    },
    sources: { type: "array", items: { type: "string" } },
  },
  required: ["companyName"],
};

export const companyInputValidator = CompanyInputSchema;

/* ---------- Clarification questions (§5.2) ---------- */

export const clarificationJsonSchema: Anthropic.Tool.InputSchema = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: { type: "string" },
      description: "필수 정보가 누락돼 임의로 채우면 안 되는 항목에 대한 구체적 질문",
    },
  },
  required: ["questions"],
};
export const clarificationValidator = z.object({ questions: z.array(z.string()).default([]) });
export type Clarifications = z.infer<typeof clarificationValidator>;

/* ---------- Gap Analysis (§ consulting core) ---------- */

export const gapJsonSchema: Anthropic.Tool.InputSchema = {
  type: "object",
  properties: {
    storyline: { type: "string", description: "투자자 관점 스토리라인 총평(강점/약점, 한 단락)" },
    orderIssues: {
      type: "array",
      items: { type: "string" },
      description: "SparkLabs 정규 순서 대비 순서/배치 문제. 예: 'Traction이 Team 뒤에 있음 → 앞으로 이동'",
    },
    missingSections: {
      type: "array",
      items: { type: "string" },
      description: "원본 덱에 사실상 통째로 빠진 정규 섹션의 라벨(예: 'Traction', 'Business Model')",
    },
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sectionKey: { type: "string", description: "제공된 섹션 키(intro/market/problem/product/solution/value_edge/traction/business_model/roadmap_vision/team/financials/closing)" },
          coverage: { type: "string", enum: ["present", "partial", "missing"] },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: { type: "string", description: "제공된 체크리스트 항목 라벨 그대로" },
                present: { type: "boolean", description: "자료에 실제로 있으면 true, 없거나 불확실하면 false" },
                note: { type: "string", description: "무엇이/어디에 있는지 또는 무엇을 채워야 하는지 짧게" },
              },
              required: ["label", "present"],
            },
          },
          weakness: { type: ["string", "null"], description: "이 섹션의 부족한 논리/약한 주장(없으면 null)" },
          recommendation: { type: "string", description: "무엇을 추가·보완해야 하는지 실행 가능한 컨설팅 지시" },
        },
        required: ["sectionKey", "coverage", "items", "recommendation"],
      },
    },
  },
  required: ["storyline", "orderIssues", "missingSections", "sections"],
};

export const gapValidator = z.object({
  storyline: z.string().default(""),
  orderIssues: z.array(z.string()).default([]),
  missingSections: z.array(z.string()).default([]),
  sections: z
    .array(
      z.object({
        sectionKey: z.string(),
        coverage: z.enum(["present", "partial", "missing"]).catch("partial"),
        items: z
          .array(z.object({ label: z.string(), present: z.boolean().catch(false), note: z.string().optional() }))
          .default([]),
        weakness: z.string().nullable().default(null),
        recommendation: z.string().default(""),
      }),
    )
    .default([]),
});
export type GapOutput = z.infer<typeof gapValidator>;

/* ---------- Script generation (§4.1) ---------- */

export const scriptJsonSchema: Anthropic.Tool.InputSchema = {
  type: "object",
  properties: {
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          no: { type: "number" },
          key: { type: "string" },
          title: { type: "string" },
          beats: {
            type: "array",
            items: {
              type: "object",
              properties: {
                text: { type: "string", description: "한 호흡의 발화. 미확인 수치는 [CONFIRM: ...] 표기" },
              },
              required: ["text"],
            },
          },
        },
        required: ["no", "key", "title", "beats"],
      },
    },
  },
  required: ["sections"],
};
export const scriptValidator = z.object({
  sections: jsonish(
    z.array(
      z.object({
        no: z.number().catch(0),
        key: z.string().catch(""),
        title: z.string().catch(""),
        beats: jsonish(z.array(z.object({ text: z.string() })), "beats"),
      }),
    ),
    "sections",
  ),
});
export type ScriptOutput = z.infer<typeof scriptValidator>;

/* ---------- Per-slide full script (dedicated pass so notes never taper) ---------- */

export const slideNotesJsonSchema: Anthropic.Tool.InputSchema = {
  type: "object",
  properties: {
    notes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          no: { type: "number", description: "슬라이드 번호" },
          speakerNotes: {
            type: "string",
            description: "이 슬라이드에서 발표자가 실제로 말하는 완전한 구어체 대본. 여러 문장을 줄바꿈(\\n)으로 나눠 쓴다. 미확인 수치는 [CONFIRM: ...].",
          },
        },
        required: ["no", "speakerNotes"],
      },
    },
  },
  required: ["notes"],
};
export const slideNotesValidator = z.object({
  notes: jsonish(
    z.array(z.object({ no: z.number(), speakerNotes: z.string().default("") })),
    "notes",
  ),
});
export type SlideNotesOutput = z.infer<typeof slideNotesValidator>;

/* ---------- Skeleton generation (§4.2) — layout-aware design model ---------- */

const chartJsonSchema = {
  type: ["object", "null"],
  properties: {
    type: { type: "string", enum: ["bar", "line", "area", "pie"] },
    title: { type: "string" },
    unit: { type: "string", description: "값 단위 예: 억원, %, 명" },
    categories: { type: "array", items: { type: "string" }, description: "x축/조각 라벨" },
    series: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          values: { type: "array", items: { type: "number" } },
        },
        required: ["name", "values"],
      },
    },
    source: { type: "string", description: "숫자 출처(파일명 등). 출처 없으면 confirmed=false" },
    confirmed: { type: "boolean", description: "업로드 자료에 실제로 있는 수치일 때만 true" },
  },
  required: ["type", "categories", "series", "confirmed"],
} as const;

const offsetPosJson = {
  type: "object",
  properties: { dx: { type: "number" }, dy: { type: "number" } },
} as const;

const slideItemSchema = {
  type: "object",
  properties: {
    no: { type: "number" },
    sectionKey: { type: "string" },
    layout: {
      type: "string",
      enum: ["cover", "statement", "bullets", "metrics", "comparison", "process", "chart", "team", "closing"],
      description: "슬라이드 아키타입. 내용 성격에 맞는 것을 고른다.",
    },
    eyebrow: { type: "string", description: "헤드라인 위 작은 라벨 예: PROBLEM (없으면 빈 문자열)" },
    headline: { type: "string", description: "슬라이드 대제목 한 줄" },
    subhead: { type: "string", description: "헤드라인 보조 문장(없으면 빈 문자열)" },
    bullets: {
      type: "array",
      items: {
        type: "object",
        properties: { text: { type: "string" }, emphasis: { type: "boolean" } },
        required: ["text", "emphasis"],
      },
      description: "bullets/statement/closing 레이아웃의 핵심 문구. 대본 전체 금지, 키 메시지만.",
    },
    metrics: {
      type: "array",
      items: {
        type: "object",
        properties: {
          value: { type: "string", description: "숫자/핵심값 예: 3초, 98%, 11억원" },
          label: { type: "string" },
          sub: { type: "string" },
        },
        required: ["value", "label"],
      },
      description: "metrics 레이아웃의 KPI 카드. 값은 자료 근거만, 미확인 시 [CONFIRM] 포함.",
    },
    columns: {
      type: "array",
      items: {
        type: "object",
        properties: {
          heading: { type: "string" },
          items: { type: "array", items: { type: "string" } },
          accent: { type: "boolean", description: "우리 열이면 true(강조)" },
        },
        required: ["heading", "items"],
      },
      description: "comparison 레이아웃의 열(우리 vs 경쟁, before/after).",
    },
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: { title: { type: "string" }, detail: { type: "string" } },
        required: ["title"],
      },
      description: "process 레이아웃의 단계/타임라인.",
    },
    team: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          role: { type: "string" },
          note: { type: "string", description: "이 문제를 풀 자격(관련 경력)" },
          fullTime: { type: "boolean" },
        },
        required: ["name"],
      },
    },
    chart: chartJsonSchema as unknown as Record<string, unknown>,
    visual: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["none", "image", "screenshot", "diagram", "logo"] },
        direction: { type: "string", description: "이 페이지 스크립트를 가장 효과적으로 이해시키는 이미지 지시" },
        needsAsset: { type: "boolean", description: "창업자 실제 자료(스크린샷/사진/로고)가 필요하면 true" },
      },
      required: ["kind", "direction"],
    },
    memo: { type: "string", description: "디자인/연출 메모. 실제 자료 필요하면 [NEEDS INPUT: ...]" },
    speakerNotes: { type: "string", description: "이 슬라이드에 매핑되는 스크립트 텍스트(대본=노트)" },
    scriptRefs: { type: "array", items: { type: "string" } },
    offsets: {
      type: "object",
      description:
        "요소별 위치 미세조정(선택). 특정 글씨/도형을 자동 배치에서 상하좌우로 이동한다. dx=슬라이드 가로 대비 %(양수=오른쪽, 음수=왼쪽), dy=세로 대비 %(양수=아래, 음수=위), 범위 -60~60. 이동이 필요 없으면 생략. 키: 제목영역 eyebrow/headline/subhead/accentRule/footer/badge, 본문 그룹 bullets/metrics/chart/visual/columns/steps/team, 그룹 내 특정 카드는 점표기 예 metrics.0(첫 지표카드)/bullets.2/columns.1/steps.3/team.0. header는 제목영역 전체. 예: 지표 카드 전체를 아래로 → {\"metrics\":{\"dx\":0,\"dy\":12}}, 첫 카드만 오른쪽 → {\"metrics.0\":{\"dx\":10,\"dy\":0}}.",
      additionalProperties: offsetPosJson,
    },
  },
  required: ["no", "sectionKey", "layout", "headline", "visual", "speakerNotes", "scriptRefs"],
} as const;

export const skeletonJsonSchema: Anthropic.Tool.InputSchema = {
  type: "object",
  properties: {
    accentColor: {
      type: "string",
      description: "덱 브랜드 액센트. 팔레트 키(indigo/blue/violet/teal/emerald/amber/rose/slate) 또는 6자리 hex. 회사 톤에 맞게.",
    },
    slides: { type: "array", items: slideItemSchema as unknown as Anthropic.Tool.InputSchema },
  },
  required: ["slides"],
};

const chartValidator = z
  .object({
    type: z.enum(["bar", "line", "area", "pie"]).catch("bar"),
    title: z.string().optional(),
    unit: z.string().optional(),
    categories: z.array(z.string()).default([]),
    series: z.array(z.object({ name: z.string(), values: z.array(z.number()).default([]) })).default([]),
    source: z.string().optional(),
    confirmed: z.boolean().default(false),
  })
  .nullable()
  .catch(null)
  .default(null);

const offsetPos = z.object({ dx: z.number().catch(0), dy: z.number().catch(0) });
// open-keyed: element names (headline, metrics, metrics.0, …). Unknown/garbage
// keys are dropped so one bad key never fails the whole slide.
const offsetsValidator = z.record(z.string(), offsetPos).optional().catch(undefined);

export const skeletonSlideValidator = z.object({
  no: z.number(),
  sectionKey: z.string(),
  layout: z
    .enum(["cover", "statement", "bullets", "metrics", "comparison", "process", "chart", "team", "closing"])
    .catch("bullets"),
  eyebrow: z.string().default(""),
  headline: z.string().default(""),
  subhead: z.string().default(""),
  bullets: z.array(z.object({ text: z.string(), emphasis: z.boolean().default(false) })).default([]),
  metrics: z.array(z.object({ value: z.string(), label: z.string(), sub: z.string().optional() })).default([]),
  columns: z
    .array(z.object({ heading: z.string(), items: z.array(z.string()).default([]), accent: z.boolean().optional() }))
    .default([]),
  steps: z.array(z.object({ title: z.string(), detail: z.string().optional() })).default([]),
  team: z
    .array(
      z.object({
        name: z.string(),
        role: z.string().optional(),
        note: z.string().optional(),
        fullTime: z.boolean().optional(),
      }),
    )
    .default([]),
  chart: chartValidator,
  visual: z
    .object({
      // model sometimes emits "chart"/"video"/etc.; coerce anything unexpected to "none"
      kind: z.enum(["none", "image", "screenshot", "diagram", "logo"]).catch("none"),
      direction: z.string().default(""),
      needsAsset: z.boolean().optional(),
    })
    .catch({ kind: "none", direction: "" })
    .default({ kind: "none", direction: "" }),
  memo: z.string().default(""),
  speakerNotes: z.string().default(""),
  scriptRefs: z.array(z.string()).default([]),
  offsets: offsetsValidator,
});

export const skeletonValidator = z.object({
  accentColor: z.string().optional(),
  slides: jsonish(z.array(skeletonSlideValidator), "slides"),
});
export type SkeletonOutput = z.infer<typeof skeletonValidator>;

/* ---------- AI Review (§8-5) ---------- */

export const reviewJsonSchema: Anthropic.Tool.InputSchema = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          severity: { type: "string", enum: ["High", "Medium", "Low"] },
          category: {
            type: "string",
            enum: ["logic_flow", "storyline_consistency", "duplication", "weak_claim", "missing_info", "unconfirmed_number"],
          },
          locationRef: { type: "string" },
          message: { type: "string" },
        },
        required: ["severity", "category", "locationRef", "message"],
      },
    },
  },
  required: ["items"],
};
export const reviewValidator = z.object({
  items: z.array(
    z.object({
      severity: z.enum(["High", "Medium", "Low"]),
      category: z.enum(["logic_flow", "storyline_consistency", "duplication", "weak_claim", "missing_info", "unconfirmed_number"]),
      locationRef: z.string(),
      message: z.string(),
    }),
  ),
});
export type ReviewOutput = z.infer<typeof reviewValidator>;
