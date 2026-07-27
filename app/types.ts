/* Client-side mirror of the engine's output shapes (app boundary types). */

export interface Beat {
  text: string;
  click: boolean;
}
export interface ScriptSection {
  no: number;
  key: string;
  title: string;
  beats: Beat[];
}
export interface Flag {
  kind: "CONFIRM" | "NEEDS_INPUT";
  docType?: "script" | "skeleton";
  locationRef: string;
  message: string;
}
export type SlideLayout =
  | "cover"
  | "statement"
  | "bullets"
  | "metrics"
  | "comparison"
  | "process"
  | "chart"
  | "team"
  | "closing";

export interface ChartSpec {
  type: "bar" | "line" | "area" | "pie";
  title?: string;
  unit?: string;
  categories: string[];
  series: Array<{ name: string; values: number[] }>;
  source?: string;
  confirmed: boolean;
}
export interface Metric {
  value: string;
  label: string;
  sub?: string;
}
export interface CompareColumn {
  heading: string;
  items: string[];
  accent?: boolean;
}
export interface ProcessStep {
  title: string;
  detail?: string;
}
export interface TeamMember {
  name: string;
  role?: string;
  note?: string;
  fullTime?: boolean;
}
export interface SlideVisual {
  kind: "none" | "image" | "screenshot" | "diagram" | "logo";
  direction: string;
  needsAsset?: boolean;
}
export type SlideStatus = "ok" | "recommend" | "needs_input" | "missing";
export interface ChecklistItem {
  label: string;
  done: boolean;
  note?: string;
}
export interface Slide {
  no: number;
  sectionKey: string;
  layout: SlideLayout;
  eyebrow: string;
  headline: string;
  subhead: string;
  bullets: Array<{ text: string; emphasis: boolean }>;
  metrics: Metric[];
  columns: CompareColumn[];
  steps: ProcessStep[];
  team: TeamMember[];
  chart: ChartSpec | null;
  visual: SlideVisual;
  memo: string;
  speakerNotes: string;
  scriptRefs: string[];
  flags: Flag[];
  status: SlideStatus;
  checklist: ChecklistItem[];
  gapNote?: string;
  offsets?: SlideOffsets;
}

/** Per-element position nudges (see engine types.ts for the key vocabulary). */
export type SlideOffset = { dx: number; dy: number };
export type SlideOffsets = Record<string, SlideOffset>;
export type Coverage = "present" | "partial" | "missing";
export interface SectionGap {
  sectionKey: string;
  title: string;
  coverage: Coverage;
  items: ChecklistItem[];
  weakness: string | null;
  recommendation: string;
}
export interface GapAnalysis {
  storyline: string;
  orderIssues: string[];
  missingSections: string[];
  sections: SectionGap[];
}
export interface ScriptDoc {
  companyName: string;
  presentationMinutes: number;
  sections: ScriptSection[];
  flags: Flag[];
}
export interface SkeletonDoc {
  companyName: string;
  presentationMinutes: number;
  accentColor?: string;
  slides: Slide[];
  flags: Flag[];
  variant?: string;
}
export interface TrackerItem {
  index: number;
  kind: "CONFIRM" | "NEEDS_INPUT";
  locationRef: string;
  message: string;
}
export interface ReviewItem {
  severity: "High" | "Medium" | "Low";
  category: string;
  locationRef: string;
  message: string;
}
export interface JobResult {
  companyName: string;
  presentationMinutes: number;
  clarifications: string[];
  gap: GapAnalysis;
  script: ScriptDoc;
  skeleton: SkeletonDoc;
  review: ReviewItem[];
  tracker: TrackerItem[];
}

/* Chat message shared by the edit assistant + Q&A chatbot (lifted to the shell
 * so switching tabs doesn't reset the conversation). */
export interface ChatMsg {
  role: "user" | "assistant" | "system";
  text: string;
}

/* A saved point-in-time snapshot for the Version History panel. */
export interface DeckVersion {
  label: string; // v0.1, v0.2, ...
  ts: number;
  note: string;
  script: ScriptDoc;
  skeleton: SkeletonDoc;
}
