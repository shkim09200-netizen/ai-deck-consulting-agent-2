/**
 * House-style configuration (§4).
 *
 * This is the encoded "consulting house style" — versioned config, NOT hardcoded
 * logic. Everything here can be overridden per-project (customStructure).
 *
 * The defaults below are derived from the real SparkLabs Batch-24 final scripts
 * (르호사 / 갭텍 / 빔스튜디오 / 슈타겐 / 슬로웨이브 / 젤코), whose observed
 * structure is:
 *   (Intro) (Market) (Problem & Existing Solutions) (Our Solution)
 *   (Business Model) (Traction) (Team) (Vision)
 * Slides are split by content in the skeleton stage — no inline `(click)` marks.
 */

export interface SectionDef {
  key: string;
  title: string;
  /** guidance injected into the generation prompt for this section */
  guidance: string;
  optional?: boolean;
}

/**
 * §4.1 — default Script structure (stage script), in SparkLabs canonical order:
 * 시장 → 문제 → 기존 솔루션 → 우리 솔루션 → Traction → Business Model →
 * Scale-up → Team → Vision. (Traction은 Business Model보다 앞, 투자자 스토리라인.)
 */
export const SCRIPT_STRUCTURE: SectionDef[] = [
  { key: "intro", title: "Intro", guidance: "발표자 이름과 회사명으로 짧게 시작. 한두 문장으로 마무리." },
  { key: "market", title: "Market", guidance: "시장 규모(TAM/SAM/SOM, 현재→미래 CAGR)와 왜 지금인지. 숫자는 반드시 소스 근거." },
  { key: "problem", title: "Problem & Existing Solutions", guidance: "구체적 타겟 유저 + 일반론이 아닌 구체적 문제. 기존 대안과 그 한계를 함께. '첫째/둘째/셋째' 구조 권장." },
  { key: "our_solution", title: "Our Solution", guidance: "제품이 무엇을, 어떻게 해결하는지, 왜 더 나은지를 번호(첫 번째로/두 번째로…)로 제시. 정량 개선치 포함." },
  { key: "traction", title: "Traction", guidance: "매출/성장/고객/리텐션/파트너십 등 실제 지표. 없으면 §4.5 대체 우선순위. 투자자에게 가장 강력한 증거." },
  { key: "business_model", title: "Business Model", guidance: "수익 구조·과금 방식·단위 경제성을 한두 문장으로 명료하게." },
  { key: "roadmap", title: "Scale-up / Roadmap", guidance: "향후 6~18개월 목표(매출/시장 확대)와 어떻게 스케일업할지." },
  { key: "team", title: "Team", guidance: "팀 배경과 이 문제를 풀 자격(관련 경력). 개별 나열보다 신뢰를 주는 서사." },
  { key: "vision", title: "Vision", guidance: "한 문장의 큰 그림 + '감사합니다'로 마무리." },
];

/**
 * §4.2 — default Skeleton structure, SparkLabs canonical order. "Our Solution"
 * splits into Product/Solution/Value Edge. Traction precedes Business Model.
 */
export const SKELETON_STRUCTURE: SectionDef[] = [
  { key: "intro", title: "Intro", guidance: "회사명/로고, 한 줄 소개." },
  { key: "market", title: "Market", guidance: "TAM/SAM/SOM, 성장률 그래프, 왜 지금. 숫자엔 출처." },
  { key: "problem", title: "Problem", guidance: "구체적 타겟 유저와 구체적 문제 + 기존 대안의 한계. 일반론 금지." },
  { key: "product", title: "Product", guidance: "무엇을 하는가 — 제품의 정체를 한 화면에." },
  { key: "solution", title: "Solution", guidance: "어떻게 해결하는가 — 실제 스크린샷/영상(mockup 아님), 초반 제시." },
  { key: "value_edge", title: "Value Edge", guidance: "왜 우리가 더 나은가 — 경쟁 대비 정량적 우위. 발표의 핵심 구간." },
  { key: "traction", title: "Traction", guidance: "지표/리텐션/파트너십/수상/고객 레퍼런스. §4.5 우선순위." },
  { key: "business_model", title: "Business Model", guidance: "수익 구조·과금·단위 경제성을 쉬운 도식으로." },
  { key: "roadmap_vision", title: "Scale-up / Vision", guidance: "6~18개월 목표·스케일업 계획과 비전을 한 흐름으로." },
  { key: "team", title: "Team", guidance: "팀 단체 사진, 관련 경력, 풀타임/파트타임 표기." },
  { key: "financials", title: "Financials", guidance: "재무 전망(선택).", optional: true },
  { key: "closing", title: "Closing/Ask", guidance: "명확한 Ask + 로고 + 연락처." },
];

/** Script section key → skeleton section keys (1:N allowed). */
export const SCRIPT_TO_SKELETON: Record<string, string[]> = {
  intro: ["intro"],
  market: ["market"],
  problem: ["problem"],
  our_solution: ["product", "solution", "value_edge"],
  traction: ["traction"],
  business_model: ["business_model"],
  roadmap: ["roadmap_vision"],
  team: ["team"],
  vision: ["roadmap_vision", "closing"],
};

/** Canonical SparkLabs skeleton order (keys), for storyline / order gap checks. */
export const CANONICAL_ORDER: string[] = SKELETON_STRUCTURE.map((s) => s.key);

/** Human labels per skeleton section key. */
export const SECTION_LABEL: Record<string, string> = Object.fromEntries(
  SKELETON_STRUCTURE.map((s) => [s.key, s.title]),
);

/**
 * SparkLabs best-practice checklist — the "기준" each slide is measured against
 * during Gap Analysis. Keys are skeleton section keys. These are the required
 * elements investors expect; the agent marks each present/absent per deck.
 */
export const SECTION_CHECKLIST: Record<string, string[]> = {
  intro: ["회사 한 줄 소개(무엇을 하는 회사인지)", "로고"],
  market: ["TAM (전체 시장 규모)", "SAM (유효 시장)", "SOM (초기 목표 시장)", "시장 성장률(CAGR)", "숫자 출처", "왜 지금(Why now)"],
  problem: ["구체적인 타겟 고객", "일반론이 아닌 구체적 문제", "문제의 시급성/규모", "기존 대안과 그 한계"],
  product: ["제품이 무엇인지 한 문장", "실제 제품 화면/데모"],
  solution: ["어떻게 해결하는지", "실제 스크린샷/영상(mockup 아님)", "정량적 개선 효과(before/after)"],
  value_edge: ["경쟁사 목록", "경쟁 대비 정량적 우위", "핵심 차별화 포인트(방어 가능성)"],
  traction: ["매출/성장 지표", "고객 수·리텐션", "파트너십/수상", "고객 인터뷰·레퍼런스"],
  business_model: ["수익 구조(어떻게 버는가)", "가격/과금 방식", "단위 경제성(Unit Economics)"],
  roadmap_vision: ["6~18개월 목표", "스케일업/확장 계획", "장기 비전"],
  team: ["핵심 팀원 배경", "이 문제를 풀 자격(관련 경력)", "풀타임/파트타임 표기", "팀 단체 사진"],
  financials: ["재무 전망(매출/손익)", "자금 사용 계획"],
  closing: ["명확한 Ask(투자 규모/사용처)", "로고와 연락처"],
};

/** §4.5 — traction fallback priority. */
export const TRACTION_FALLBACK: Array<{ field: keyof import("./types").Traction; label: string }> = [
  { field: "quantitative", label: "정량 지표(성장·매출·유저)" },
  { field: "awards", label: "수상" },
  { field: "partnerships", label: "파트너십" },
  { field: "press", label: "언론보도" },
];

/** §4.3 — time budget rules (skeleton). */
export const TIME_BUDGET = {
  totalMaxMinutes: 7,
  startToProblemMaxSeconds: 90,
  valueEdgeMinSeconds: 120,
  valueEdgeMaxSeconds: 180,
  scriptPagesApprox: 1.5,
  bodyFontPt: 11,
} as const;

/** The narrative rules block injected into every generation prompt (§5.4 HOUSE_STYLE). */
export const HOUSE_STYLE_RULES = `
너는 SparkLabs 데모데이 피칭 컨설턴트다. 아래 하우스 스타일을 반드시 지킨다.

[언어와 어조]
- 한국어. 실제 무대에서 말하듯 자연스러운 구어체("~습니다", "~인데요"). 보고서 문체 금지.
- 문장은 짧고 명료하게. 청중이 귀로 듣고 이해할 수 있어야 한다.

[구조]
- 각 섹션은 괄호 헤더로 시작한다. 예: (Intro) (Market) (Problem & Existing Solutions) ...
- 슬라이드 분할은 스켈레톤 단계가 내용(메시지) 단위로 정한다. click 같은 전환 마커는 쓰지 않는다.

[환각 방지 — 최우선]
- 제공되지 않은 통계·인용·주장·숫자는 절대 지어내지 않는다.
- 확인이 필요한 수치/주장은 본문에 [CONFIRM: 무엇을 확인해야 하는지]로 표기한다.
- 창업자가 직접 쓴 표현(특히 문제 정의)은 최대한 원문 그대로 살린다.

[품질 기준]
- 숫자로 말한다. 개선 효과·시장·트랙션은 구체 수치로.
- Problem은 구체적 타겟 유저 + 구체적 문제. 일반론 금지.
- Team은 이 문제를 풀 자격(관련 경력)이 드러나게.
- Vision은 한 문장의 큰 그림 + "감사합니다"로 닫는다.
`.trim();
