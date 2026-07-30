import { z } from "zod";

/* ============================================================
 * CompanyInput — normalized company package (§5.1)
 * ============================================================ */

/** One traction category → string[], tolerant of a single string / null. */
const tractionList = z
  .preprocess((v) => (v == null ? [] : Array.isArray(v) ? v : [String(v)]), z.array(z.string().catch("")))
  .catch([] as string[]);

/**
 * Traction. Deliberately tolerant: the model sometimes returns this whole field
 * as a plain string (or omits sub-arrays) instead of the object — salvage what
 * we can instead of failing the ENTIRE extraction on one field's format.
 */
export const TractionSchema = z
  .preprocess(
    (v) =>
      v == null ? {} : typeof v === "string" ? { quantitative: [v] } : typeof v === "object" ? v : {},
    z.object({
      quantitative: tractionList,
      awards: tractionList,
      partnerships: tractionList,
      press: tractionList,
    }),
  )
  .catch({ quantitative: [], awards: [], partnerships: [], press: [] });
export type Traction = z.infer<typeof TractionSchema>;

/**
 * Robust presentation-minutes coercion. The model sometimes emits null or a
 * string ("7", "7분"); z.number() alone would throw. Coerce to a number and
 * fall back to 5 when it is missing / null / empty / NaN / non-positive.
 */
export const PresentationMinutesSchema = z
  .preprocess((v) => {
    if (v === null || v === undefined || v === "") return 5;
    const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.]/g, ""));
    return Number.isNaN(n) || n <= 0 ? 5 : n;
  }, z.number())
  .default(5);

export const CompanyMetaSchema = z.object({
  vision: z.string().nullable().default(null),
  tone: z.string().nullable().default(null), // tone & manner request
  keyInvestorMessage: z.string().nullable().default(null),
  presentationMinutes: PresentationMinutesSchema,
  mustInclude: z.array(z.string()).default([]),
});
export type CompanyMeta = z.infer<typeof CompanyMetaSchema>;

export const CompanyInputSchema = z.object({
  companyName: z.string(),
  oneLiner: z.string().nullable().default(null),
  sector: z.string().nullable().default(null),
  founderBackground: z.string().nullable().default(null),
  /** 창업자 표현 그대로 보존 (§4.6) */
  problem: z.string().nullable().default(null),
  existingAlternatives: z.string().nullable().default(null),
  ourSolution: z.string().nullable().default(null),
  differentiators: z.string().nullable().default(null),
  traction: TractionSchema,
  roadmap: z.string().nullable().default(null),
  freeformNotes: z.string().nullable().default(null),
  // tolerant: coerce a stringified/absent meta into an object before parsing
  meta: z.preprocess((v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {}), CompanyMetaSchema),
  /** provenance: which source assets each field was derived from */
  sources: z.array(z.string()).default([]),
});
export type CompanyInput = z.infer<typeof CompanyInputSchema>;

/* ============================================================
 * Flags — [CONFIRM] / [NEEDS INPUT] (§4, §9)
 * ============================================================ */

export type FlagKind = "CONFIRM" | "NEEDS_INPUT";

export interface Flag {
  kind: FlagKind;
  docType: "script" | "skeleton";
  /** human-readable location, e.g. "Script §7 (Traction)" or "Slide 6" */
  locationRef: string;
  message: string;
}

/* ============================================================
 * ScriptDoc (§4.1) — the stage script
 * ============================================================ */

export interface ScriptSection {
  /** 1-based ordinal used to map to skeleton slides */
  no: number;
  /** canonical key, e.g. "problem" */
  key: string;
  /** section header label as it appears in the doc, e.g. "Problem & Existing Solutions" */
  title: string;
  /** Ordered spoken lines for this section. The skeleton stage splits slides by
   *  message/content — there are no `(click)` markers. */
  beats: ScriptBeat[];
}

export interface ScriptBeat {
  text: string;
}

export interface ScriptDoc {
  companyName: string;
  presentationMinutes: number;
  sections: ScriptSection[];
  flags: Flag[];
}

/* ============================================================
 * SkeletonDoc (§4.2) — slide blueprint
 *
 * Upgraded to a layout-aware, near-final design model. Each slide picks a
 * `layout` archetype and fills the structured content groups that layout uses.
 * The HTML preview (SlideCanvas) and the pptx exporter render from this same
 * shape so what you see == what you download.
 * ============================================================ */

/** Slide archetypes. The renderer switches on this to lay content out. */
export type SlideLayout =
  | "cover" //       title / intro — company name, one-liner, presenter
  | "statement" //   one big message, centered (transition / punchline)
  | "bullets" //     headline + bullet points (+ optional side visual)
  | "metrics" //     KPI / stat cards row (traction, improvements)
  | "comparison" //  2+ columns — us vs them, before/after
  | "process" //     numbered steps / timeline / how-it-works
  | "chart" //       data-forward slide (market size, growth)
  | "team" //        people grid
  | "closing"; //    Ask + logo + contact

export interface ChartSpec {
  type: "bar" | "line" | "area" | "pie";
  title?: string;
  /** unit suffix for value labels, e.g. "억원", "%", "명" */
  unit?: string;
  /** x-axis / slice labels */
  categories: string[];
  series: Array<{ name: string; values: number[] }>;
  /** provenance note; if numbers are not source-backed, keep confirmed=false */
  source?: string;
  /** true only when the values come straight from an uploaded source */
  confirmed: boolean;
}

export interface Metric {
  /** the headline number/phrase, e.g. "3초", "98%", "11억원" */
  value: string;
  /** what it measures, e.g. "평균 처리 시간" */
  label: string;
  /** optional small caption / delta, e.g. "전년 대비 +240%" */
  sub?: string;
}

export interface CompareColumn {
  heading: string;
  items: string[];
  /** true → highlighted column (usually "우리") */
  accent?: boolean;
}

export interface ProcessStep {
  title: string;
  detail?: string;
}

export interface TeamMember {
  name: string;
  role?: string;
  /** credential / background that qualifies them for this problem */
  note?: string;
  fullTime?: boolean;
}

export interface SlideVisual {
  kind: "none" | "image" | "screenshot" | "diagram" | "logo";
  /** "이 페이지 스크립트를 가장 효과적으로 이해시키는 이미지" direction */
  direction: string;
  /** true → a real founder-supplied asset is required here */
  needsAsset?: boolean;
}

/**
 * Consulting status of a slide against the SparkLabs standard.
 * - ok:          required elements present, nothing critical missing
 * - recommend:   present but could be strengthened (recommendation given)
 * - needs_input: partially present — some required data/elements missing
 * - missing:     this section/slide is essentially absent from the source deck
 */
export type SlideStatus = "ok" | "recommend" | "needs_input" | "missing";

export interface ChecklistItem {
  /** required element label (from SECTION_CHECKLIST) */
  label: string;
  /** whether the source materials actually contain it */
  done: boolean;
  /** optional short note (what/where, or what to add) */
  note?: string;
}

export interface Slide {
  no: number;
  /** which skeleton section this slide belongs to, e.g. "value_edge" */
  sectionKey: string;
  /** layout archetype that governs how the fields below are rendered */
  layout: SlideLayout;
  /** small label above the headline, e.g. "PROBLEM" (may be empty) */
  eyebrow: string;
  /** the slide's main title line */
  headline: string;
  /** supporting line under the headline (may be empty) */
  subhead: string;
  /** body bullets (bullets / statement / closing layouts) */
  bullets: Array<{ text: string; emphasis: boolean }>;
  /** KPI cards (metrics layout) */
  metrics: Metric[];
  /** comparison columns (comparison layout) */
  columns: CompareColumn[];
  /** numbered steps (process layout) */
  steps: ProcessStep[];
  /** people (team layout) */
  team: TeamMember[];
  /** data chart (chart / metrics layouts) */
  chart: ChartSpec | null;
  /** image/screenshot direction placeholder */
  visual: SlideVisual;
  /** free design/animation memo + [NEEDS INPUT] */
  memo: string;
  /** speaker notes = the mapped script text for this slide */
  speakerNotes: string;
  /** references back to script sections, e.g. ["3", "3.2"] */
  scriptRefs: string[];
  flags: Flag[];
  /** consulting status vs SparkLabs standard (from Gap Analysis) */
  status: SlideStatus;
  /** per-slide required-element checklist (present/absent) */
  checklist: ChecklistItem[];
  /** what to add/fix for this slide (consulting recommendation) */
  gapNote?: string;
  /** optional per-element position nudges on top of the auto-layout */
  offsets?: SlideOffsets;
}

/**
 * Per-element position nudges on top of the auto-layout. Keys name a renderable
 * element; BOTH renderers (SlideCanvas + pptx) apply the same key, so an edit
 * moves the element identically on screen and in the export.
 *
 * Recognized keys (any layout):
 *  - header parts: "eyebrow" | "headline" | "subhead" | "accentRule" | "footer" | "badge"
 *  - whole body group: "bullets" | "metrics" | "chart" | "visual" | "columns" | "steps" | "team"
 *  - a single card/item in a group: "metrics.0", "bullets.2", "columns.1", "steps.3", "team.0"
 *  - "header" still nudges the whole title block (back-compat).
 * dx = percent of slide WIDTH (+right / −left), dy = percent of slide HEIGHT (+down / −up), each −60..60.
 */
export type SlideBlock =
  | "header" | "eyebrow" | "headline" | "subhead" | "accentRule" | "footer" | "badge"
  | "bullets" | "metrics" | "chart" | "visual" | "columns" | "steps" | "team";
export type SlideOffset = { dx: number; dy: number };
export type SlideOffsets = Record<string, SlideOffset>;

export interface SkeletonDoc {
  companyName: string;
  presentationMinutes: number;
  /** optional brand accent (hex, no #). Falls back to the default theme. */
  accentColor?: string;
  slides: Slide[];
  flags: Flag[];
  /** selected design variant id (minimal/bold/editorial). Default "minimal". */
  variant?: string;
}

/* ============================================================
 * Gap Analysis (§ consulting core) — existing deck vs SparkLabs standard
 * ============================================================ */

export type Coverage = "present" | "partial" | "missing";

export interface SectionGap {
  /** skeleton section key, e.g. "market" */
  sectionKey: string;
  /** human label, e.g. "Market" */
  title: string;
  /** how well the source deck covers this section */
  coverage: Coverage;
  /** each required element (SparkLabs checklist) marked present/absent */
  items: ChecklistItem[];
  /** weak logic / storyline problem in this section, if any */
  weakness: string | null;
  /** actionable consulting guidance: what to add or fix */
  recommendation: string;
}

export interface GapAnalysis {
  /** overall storyline / investor-narrative verdict */
  storyline: string;
  /** ordering problems, e.g. "Traction이 Team 뒤에 있음 → 앞으로 이동" */
  orderIssues: string[];
  /** canonical sections entirely absent from the source deck */
  missingSections: string[];
  /** per-section gap findings */
  sections: SectionGap[];
}

/* ============================================================
 * Project bundle
 * ============================================================ */

export interface DeckProject {
  input: CompanyInput;
  gap?: GapAnalysis;
  script?: ScriptDoc;
  skeleton?: SkeletonDoc;
}
