import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

import { parseFile, parseUrl, type ParsedSource } from "@engine/ingestion/parse.js";
import {
  extractCompanyInput,
  getClarifications,
  analyzeGaps,
  generateScript,
  generateSkeleton,
  reviewDeck,
} from "@engine/llm/pipeline.js";
import { writeScriptDocx } from "@engine/render/docx.js";
import { writeSkeletonPptx } from "@engine/render/pptx.js";
import { buildTracker, type TrackerItem } from "@engine/domain/flags.js";
import type { CompanyInput, GapAnalysis, ScriptDoc, SkeletonDoc } from "@engine/domain/types.js";
import type { ReviewOutput } from "@engine/llm/schemas.js";
import { recordGeneration } from "@/lib/store";

export type StageStatus = "pending" | "active" | "done" | "error";
export interface Stage {
  key: string;
  label: string;
  status: StageStatus;
  detail?: string;
}

const STAGE_DEFS: Array<{ key: string; label: string }> = [
  { key: "parse", label: "자료 파싱" },
  { key: "ingest", label: "회사 정보 추출 (Ingestion)" },
  { key: "gap", label: "Gap 분석 (SparkLabs 기준 진단)" },
  { key: "clarify", label: "명확화 질문 확인" },
  { key: "script", label: "Step 1 — Script 생성" },
  { key: "skeleton", label: "Step 2 — Skeleton 생성" },
  { key: "review", label: "AI Review + 통합 트래커" },
];

export interface JobResult {
  companyName: string;
  presentationMinutes: number;
  input: CompanyInput;
  clarifications: string[];
  gap: GapAnalysis;
  script: ScriptDoc;
  skeleton: SkeletonDoc;
  review: ReviewOutput["items"];
  tracker: TrackerItem[];
  files: { scriptDocx: string; skeletonPptx: string };
  /** on-demand English version (generated when the user toggles English) */
  en?: {
    script: ScriptDoc;
    skeleton: SkeletonDoc;
    files: { scriptDocx: string; skeletonPptx: string };
  };
}

export interface Job {
  id: string;
  version: number;
  status: "running" | "done" | "error";
  progress: number; // 0..100
  stages: Stage[];
  sourceNames: string[];
  directives?: string;
  urls?: string[];
  projectId?: string; // dashboard project this generation belongs to
  error?: string;
  result?: JobResult;
  dir: string; // where uploads + outputs live
}

/**
 * In-memory job store. Pinned to globalThis so every API route bundle shares
 * ONE Map — in Next.js dev each route can otherwise get its own module scope,
 * which made freshly-compiled routes (e.g. /translate) see an empty store and
 * return 404 for jobs created by /generate.
 */
const globalStore = globalThis as unknown as { __deckJobs?: Map<string, Job> };
const jobs: Map<string, Job> = (globalStore.__deckJobs ??= new Map<string, Job>());

const DATA_ROOT = path.join(process.cwd(), ".data");

const jobJsonPath = (dir: string) => path.join(dir, "job.json");

/** Snapshot the job (sans functions) to disk so it survives a server restart. */
async function persistJob(job: Job): Promise<void> {
  try {
    await writeFile(jobJsonPath(job.dir), JSON.stringify(job), "utf8");
  } catch {
    /* best-effort */
  }
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

/**
 * Return the job from memory, or rehydrate it from `.data/<id>/job.json` if a
 * previous run persisted it (e.g. after a server restart, or when reopening a
 * saved project). Falls back to undefined if nothing is on disk.
 */
export async function getOrLoadJob(id: string): Promise<Job | undefined> {
  const mem = jobs.get(id);
  if (mem) return mem;
  const dir = path.join(DATA_ROOT, id);
  try {
    const raw = await readFile(jobJsonPath(dir), "utf8");
    const job = JSON.parse(raw) as Job;
    job.dir = dir; // path is environment-relative; always trust the current location
    jobs.set(id, job);
    return job;
  } catch {
    return undefined;
  }
}

export function snapshot(job: Job) {
  return {
    id: job.id,
    version: job.version,
    status: job.status,
    progress: job.progress,
    stages: job.stages,
    sourceNames: job.sourceNames,
    error: job.error,
    result: job.result,
  };
}

function bump(job: Job) {
  job.version += 1;
}

function setStage(job: Job, key: string, status: StageStatus, detail?: string) {
  const s = job.stages.find((x) => x.key === key);
  if (s) {
    s.status = status;
    if (detail !== undefined) s.detail = detail;
  }
  const doneCount = job.stages.filter((x) => x.status === "done").length;
  job.progress = Math.round((doneCount / job.stages.length) * 100);
  bump(job);
}

function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, "_").trim() || "company";
}

/** Create a job, persist uploaded files, and kick off the pipeline (not awaited). */
export async function createJob(
  files: Array<{ name: string; buffer: Buffer }>,
  opts?: { directives?: string; urls?: string[]; projectId?: string },
): Promise<Job> {
  const id = randomUUID();
  const dir = path.join(DATA_ROOT, id);
  await mkdir(dir, { recursive: true });

  const savedPaths: string[] = [];
  for (const f of files) {
    const p = path.join(dir, safeName(f.name));
    await writeFile(p, f.buffer);
    savedPaths.push(p);
  }

  const urls = (opts?.urls ?? []).filter((u) => /^https?:\/\//i.test(u.trim()));
  const job: Job = {
    id,
    version: 0,
    status: "running",
    progress: 0,
    stages: STAGE_DEFS.map((d) => ({ ...d, status: "pending" as StageStatus })),
    sourceNames: [...files.map((f) => f.name), ...urls],
    directives: opts?.directives,
    urls,
    projectId: opts?.projectId,
    dir,
  };
  jobs.set(id, job);

  // fire and forget
  runPipeline(job, savedPaths).catch((e) => {
    job.status = "error";
    job.error = e instanceof Error ? e.message : String(e);
    const active = job.stages.find((s) => s.status === "active");
    if (active) active.status = "error";
    bump(job);
  });

  return job;
}

async function runPipeline(job: Job, filePaths: string[]) {
  // 1) parse — files + any website URLs
  setStage(job, "parse", "active");
  const sources: ParsedSource[] = [];
  for (const p of filePaths) {
    try {
      sources.push(await parseFile(p));
    } catch (e) {
      /* skip unreadable file, keep going */
    }
  }
  for (const u of job.urls ?? []) {
    try {
      const src = await parseUrl(u);
      if (src.text) sources.push(src);
    } catch (e) {
      /* skip unreachable url, keep going */
    }
  }
  if (sources.length === 0) throw new Error("업로드된 자료를 파싱하지 못했습니다.");
  setStage(job, "parse", "done", `${sources.length}개 소스`);

  // 2) ingest
  setStage(job, "ingest", "active");
  const input = await extractCompanyInput(sources, job.directives);
  setStage(job, "ingest", "done", `${input.companyName} · 발표 ${input.meta.presentationMinutes}분`);

  // 2.5–4) gap, clarify and script all depend only on `input` (script does NOT
  // need the gap), so run them concurrently to shorten the critical path. The
  // skeleton downstream needs script + gap, so it waits for this barrier.
  setStage(job, "gap", "active");
  setStage(job, "clarify", "active");
  setStage(job, "script", "active");
  const [gap, clar, script] = await Promise.all([
    analyzeGaps(input, sources).then((g) => {
      setStage(job, "gap", "done", `누락 섹션 ${g.missingSections.length} · 순서 이슈 ${g.orderIssues.length}`);
      return g;
    }),
    getClarifications(input).then((c) => {
      setStage(job, "clarify", "done", c.questions.length ? `${c.questions.length}개 질문` : "추가 질문 없음");
      return c;
    }),
    generateScript(input, { directives: job.directives }).then((s) => {
      setStage(job, "script", "done", `${s.sections.length}개 섹션`);
      return s;
    }),
  ]);
  const questions = clar.questions;

  // 5) skeleton (gap-aware: missing data becomes [NEEDS INPUT] / placeholders)
  setStage(job, "skeleton", "active");
  const skeleton = await generateSkeleton(input, script, { directives: job.directives, gap });
  setStage(job, "skeleton", "done", `${skeleton.slides.length}개 슬라이드`);

  // 6) review (light model) runs concurrently with rendering — neither needs the other.
  setStage(job, "review", "active");
  const reviewP = reviewDeck(script, skeleton);
  const tracker = buildTracker(script, skeleton);

  const name = safeName(input.companyName);
  const scriptDocx = `${name}_script_v0.1.docx`;
  const skeletonPptx = `${name}_skeleton_v0.1.pptx`;
  await Promise.all([
    writeScriptDocx(script, path.join(job.dir, scriptDocx)),
    writeSkeletonPptx(skeleton, path.join(job.dir, skeletonPptx)),
  ]);
  const review = await reviewP;
  setStage(job, "review", "done", `${review.items.length}개 지적 · 미해결 ${tracker.length}건`);

  job.result = {
    companyName: input.companyName,
    presentationMinutes: input.meta.presentationMinutes,
    input,
    clarifications: questions,
    gap,
    script,
    skeleton,
    review: review.items,
    tracker,
    files: { scriptDocx, skeletonPptx },
  };
  job.status = "done";
  job.progress = 100;
  bump(job);
  await persistJob(job); // durable result so reopening the project restores it

  // link this generation to its dashboard project (versions++, one-liner, name)
  if (job.projectId) {
    const cover = skeleton.slides.find((s) => s.layout === "cover");
    const oneLiner = (cover?.subhead || skeleton.slides[0]?.subhead || "").trim();
    await recordGeneration(job.projectId, {
      jobId: job.id,
      oneLiner: oneLiner || undefined,
      companyName: input.companyName,
    }).catch(() => {});
  }
}

/**
 * Persist an edited deck: recompute the unified tracker, re-render docx/pptx
 * under a new version, and point the job's download files at the newest render.
 * Pure rendering — no Claude call, so this works without an API key.
 */
export async function persistEditedDeck(
  job: Job,
  script: ScriptDoc,
  skeleton: SkeletonDoc,
  version: string,
): Promise<{ scriptDocx: string; skeletonPptx: string }> {
  if (!job.result) throw new Error("job has no result to update");
  const v = version.replace(/[^0-9.]/g, "") || "0.1";
  const name = safeName(job.result.companyName);
  const scriptDocx = `${name}_script_v${v}.docx`;
  const skeletonPptx = `${name}_skeleton_v${v}.pptx`;
  await writeScriptDocx(script, path.join(job.dir, scriptDocx));
  await writeSkeletonPptx(skeleton, path.join(job.dir, skeletonPptx));

  job.result.script = script;
  job.result.skeleton = skeleton;
  job.result.tracker = buildTracker(script, skeleton);
  job.result.files = { scriptDocx, skeletonPptx };
  bump(job);
  await persistJob(job);
  return { scriptDocx, skeletonPptx };
}

/**
 * Render the English deck under a new set of files and store it on the job.
 * The translated ScriptDoc/SkeletonDoc are produced by the caller (LLM); this
 * only renders + persists them so downloads work.
 */
export async function persistTranslatedDeck(
  job: Job,
  scriptEn: ScriptDoc,
  skeletonEn: SkeletonDoc,
): Promise<JobResult["en"]> {
  if (!job.result) throw new Error("job has no result to translate");
  const name = safeName(job.result.companyName);
  const scriptDocx = `${name}_script_EN.docx`;
  const skeletonPptx = `${name}_slides_EN.pptx`;
  await writeScriptDocx(scriptEn, path.join(job.dir, scriptDocx), "en");
  await writeSkeletonPptx(skeletonEn, path.join(job.dir, skeletonPptx), "en");
  job.result.en = { script: scriptEn, skeleton: skeletonEn, files: { scriptDocx, skeletonPptx } };
  bump(job);
  await persistJob(job);
  return job.result.en;
}

/**
 * Render (and cache) a pptx for a specific design variant on demand. One
 * skeleton → N visually distinct decks, so we don't store all N — we render the
 * requested variant fresh from the current (possibly edited) skeleton. Falls
 * back to the stored default file when no variant / an unknown one is asked.
 */
export async function renderVariantPptx(
  job: Job,
  variant: string,
  lang: "ko" | "en" = "ko",
): Promise<string | undefined> {
  if (!job.result) return undefined;
  const skeleton = lang === "en" ? job.result.en?.skeleton : job.result.skeleton;
  if (!skeleton) return undefined;
  const v = (variant || "minimal").replace(/[^a-z]/gi, "").toLowerCase() || "minimal";
  const name = safeName(job.result.companyName);
  const fname = `${name}_slides_${v}${lang === "en" ? "_EN" : ""}.pptx`;
  await writeSkeletonPptx(skeleton, path.join(job.dir, fname), lang, v);
  return path.join(job.dir, fname);
}

/** Resolve the on-disk path of a produced file for download. */
export function jobFilePath(job: Job, type: "docx" | "pptx" | "docx-en" | "pptx-en"): string | undefined {
  if (!job.result) return undefined;
  const r = job.result;
  const map: Record<string, string | undefined> = {
    docx: r.files.scriptDocx,
    pptx: r.files.skeletonPptx,
    "docx-en": r.en?.files.scriptDocx,
    "pptx-en": r.en?.files.skeletonPptx,
  };
  const fname = map[type];
  return fname ? path.join(job.dir, fname) : undefined;
}

/** Best-effort cleanup (not wired to a scheduler in M2). */
export async function deleteJob(id: string) {
  const job = jobs.get(id);
  if (!job) return;
  jobs.delete(id);
  await rm(job.dir, { recursive: true, force: true }).catch(() => {});
}

export { os };
