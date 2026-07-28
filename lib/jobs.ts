import { randomUUID } from "node:crypto";

import { parseBuffer, parseUrl, type ParsedSource } from "@engine/ingestion/parse.js";
import {
  extractCompanyInput,
  getClarifications,
  analyzeGaps,
  generateScript,
  generateSkeleton,
  reviewDeck,
} from "@engine/llm/pipeline.js";
import { renderScriptDocxBuffer } from "@engine/render/docx.js";
import { renderSkeletonPptxBuffer } from "@engine/render/pptx.js";
import { buildTracker, type TrackerItem } from "@engine/domain/flags.js";
import type { CompanyInput, GapAnalysis, ScriptDoc, SkeletonDoc } from "@engine/domain/types.js";
import type { ReviewOutput } from "@engine/llm/schemas.js";
import { recordGeneration } from "@/lib/store";
import { storage, DOCX_MIME, PPTX_MIME } from "@/lib/storage";

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

/** How far the staged pipeline has progressed. Each client-driven step advances
 * this one notch so no single request runs the whole (multi-minute) pipeline —
 * required to stay under a serverless function's time limit. */
export type JobPhase = "ingested" | "scripted" | "skeletoned" | "done";

/** Intermediate pipeline state carried between steps (persisted with the job). */
interface JobWork {
  input: CompanyInput;
  sources?: ParsedSource[];
  gap?: GapAnalysis;
  clarifications?: string[];
  script?: ScriptDoc;
  skeleton?: SkeletonDoc;
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
  phase?: JobPhase;
  work?: JobWork;
  error?: string;
  result?: JobResult;
}

/**
 * Best-effort per-instance cache. The durable copy in the storage adapter
 * (`jobs/<id>/job.json`) is the source of truth — every cross-request read
 * falls back to it, so the app never assumes a shared process memory (which a
 * serverless host does not provide).
 */
const globalStore = globalThis as unknown as { __deckJobs?: Map<string, Job> };
const jobs: Map<string, Job> = (globalStore.__deckJobs ??= new Map<string, Job>());

const jobJsonKey = (id: string) => `jobs/${id}/job.json`;
const jobFileKey = (id: string, filename: string) => `jobs/${id}/${filename}`;

/** Snapshot the job to durable storage so other requests can read it. */
async function persistJob(job: Job): Promise<void> {
  try {
    await storage.putJson(jobJsonKey(job.id), job);
  } catch {
    /* best-effort */
  }
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

/**
 * Load a job, with **durable storage as the source of truth**. This matters on
 * serverless: the staged pipeline may run each step on a different instance, so
 * a per-instance cache can be stale (it wouldn't see another instance's
 * update). We read storage first and only fall back to the local cache if
 * storage has nothing yet (e.g. a momentary read miss right after create).
 */
export async function getOrLoadJob(id: string): Promise<Job | undefined> {
  const stored = await storage.getJson<Job>(jobJsonKey(id));
  if (stored) {
    jobs.set(id, stored);
    return stored;
  }
  return jobs.get(id);
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

/**
 * Start a job: parse the uploads and extract the company input (one LLM call).
 * The rest of the pipeline runs in later `advanceJob` steps so no single request
 * runs the whole multi-minute pipeline — this keeps each request under a
 * serverless function's time limit. Returns the job at phase "ingested".
 */
export async function createJob(
  files: Array<{ name: string; buffer: Buffer }>,
  opts?: { directives?: string; urls?: string[]; projectId?: string },
): Promise<Job> {
  const id = randomUUID();
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
  };
  jobs.set(id, job);

  try {
    // 1) parse — file buffers (no disk) + any website URLs
    setStage(job, "parse", "active");
    const sources: ParsedSource[] = [];
    for (const f of files) {
      try {
        sources.push(await parseBuffer(f.name, f.buffer));
      } catch {
        /* skip unreadable file, keep going */
      }
    }
    for (const u of job.urls ?? []) {
      try {
        const src = await parseUrl(u);
        if (src.text) sources.push(src);
      } catch {
        /* skip unreachable url, keep going */
      }
    }
    if (sources.length === 0) throw new Error("업로드된 자료를 파싱하지 못했습니다.");
    setStage(job, "parse", "done", `${sources.length}개 소스`);

    // 2) ingest (gap also needs the raw sources, so stash them on work via input)
    setStage(job, "ingest", "active");
    const input = await extractCompanyInput(sources, job.directives);
    setStage(job, "ingest", "done", `${input.companyName} · 발표 ${input.meta.presentationMinutes}분`);

    job.work = { input, sources };
    job.phase = "ingested";
    bump(job);
    await persistJob(job);
  } catch (e) {
    failJob(job, e);
  }

  return job;
}

function failJob(job: Job, e: unknown) {
  job.status = "error";
  job.error = e instanceof Error ? e.message : String(e);
  const active = job.stages.find((s) => s.status === "active");
  if (active) active.status = "error";
  bump(job);
}

/**
 * Advance a running job by exactly one bounded step (one chunk of LLM work),
 * persisting after each. The client calls this repeatedly until status is
 * "done" or "error". Splitting the pipeline this way keeps every request short
 * enough for serverless time limits.
 */
export async function advanceJob(job: Job): Promise<Job> {
  if (job.status !== "running" || !job.work) return job;
  try {
    if (job.phase === "ingested") {
      // gap + clarify + script (all derive from input) run concurrently
      const input = job.work.input;
      const sources = job.work.sources ?? [];
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
      job.work.gap = gap;
      job.work.clarifications = clar.questions;
      job.work.script = script;
      job.phase = "scripted";
    } else if (job.phase === "scripted") {
      const { input, script, gap } = job.work;
      setStage(job, "skeleton", "active");
      const skeleton = await generateSkeleton(input, script!, { directives: job.directives, gap });
      setStage(job, "skeleton", "done", `${skeleton.slides.length}개 슬라이드`);
      job.work.skeleton = skeleton;
      job.phase = "skeletoned";
    } else if (job.phase === "skeletoned") {
      const { input, script, skeleton, gap, clarifications } = job.work;
      setStage(job, "review", "active");
      const review = await reviewDeck(script!, skeleton!);
      const tracker = buildTracker(script!, skeleton!);

      const name = safeName(input.companyName);
      const scriptDocx = `${name}_script_v0.1.docx`;
      const skeletonPptx = `${name}_skeleton_v0.1.pptx`;
      const [docxBuf, pptxBuf] = await Promise.all([
        renderScriptDocxBuffer(script!, "ko"),
        renderSkeletonPptxBuffer(skeleton!, "ko", skeleton!.variant),
      ]);
      await Promise.all([
        storage.putBinary(jobFileKey(job.id, scriptDocx), docxBuf, DOCX_MIME),
        storage.putBinary(jobFileKey(job.id, skeletonPptx), pptxBuf, PPTX_MIME),
      ]);
      setStage(job, "review", "done", `${review.items.length}개 지적 · 미해결 ${tracker.length}건`);

      job.result = {
        companyName: input.companyName,
        presentationMinutes: input.meta.presentationMinutes,
        input,
        clarifications: clarifications ?? [],
        gap: gap!,
        script: script!,
        skeleton: skeleton!,
        review: review.items,
        tracker,
        files: { scriptDocx, skeletonPptx },
      };
      job.status = "done";
      job.progress = 100;
      job.phase = "done";
      job.work = undefined; // drop intermediate state now that result is assembled

      if (job.projectId) {
        const cover = skeleton!.slides.find((s) => s.layout === "cover");
        const oneLiner = (cover?.subhead || skeleton!.slides[0]?.subhead || "").trim();
        await recordGeneration(job.projectId, {
          jobId: job.id,
          oneLiner: oneLiner || undefined,
          companyName: input.companyName,
        }).catch(() => {});
      }
    }
    bump(job);
    await persistJob(job);
  } catch (e) {
    failJob(job, e);
    await persistJob(job);
  }
  return job;
}

/**
 * Persist an edited deck: recompute the unified tracker, re-render docx/pptx
 * under a new version to storage, and point the job's download files at the
 * newest render. Pure rendering — no Claude call, so this works without a key.
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
  const [docxBuf, pptxBuf] = await Promise.all([
    renderScriptDocxBuffer(script, "ko"),
    renderSkeletonPptxBuffer(skeleton, "ko", skeleton.variant),
  ]);
  await Promise.all([
    storage.putBinary(jobFileKey(job.id, scriptDocx), docxBuf, DOCX_MIME),
    storage.putBinary(jobFileKey(job.id, skeletonPptx), pptxBuf, PPTX_MIME),
  ]);

  job.result.script = script;
  job.result.skeleton = skeleton;
  job.result.tracker = buildTracker(script, skeleton);
  job.result.files = { scriptDocx, skeletonPptx };
  bump(job);
  await persistJob(job);
  return { scriptDocx, skeletonPptx };
}

/**
 * Render the English deck to storage under a new set of files and store it on
 * the job. The translated docs are produced by the caller (LLM); this renders
 * + persists them so downloads work.
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
  const [docxBuf, pptxBuf] = await Promise.all([
    renderScriptDocxBuffer(scriptEn, "en"),
    renderSkeletonPptxBuffer(skeletonEn, "en", skeletonEn.variant),
  ]);
  await Promise.all([
    storage.putBinary(jobFileKey(job.id, scriptDocx), docxBuf, DOCX_MIME),
    storage.putBinary(jobFileKey(job.id, skeletonPptx), pptxBuf, PPTX_MIME),
  ]);
  job.result.en = { script: scriptEn, skeleton: skeletonEn, files: { scriptDocx, skeletonPptx } };
  bump(job);
  await persistJob(job);
  return job.result.en;
}

/**
 * Render (on demand, no storage) a pptx buffer for a specific design variant.
 * One skeleton → N visually distinct decks, so we render the requested variant
 * fresh from the current (possibly edited) skeleton at download time.
 */
export async function renderVariantBuffer(
  job: Job,
  variant: string,
  lang: "ko" | "en" = "ko",
): Promise<{ buffer: Buffer; filename: string } | undefined> {
  if (!job.result) return undefined;
  const skeleton = lang === "en" ? job.result.en?.skeleton : job.result.skeleton;
  if (!skeleton) return undefined;
  const v = (variant || "minimal").replace(/[^a-z]/gi, "").toLowerCase() || "minimal";
  const name = safeName(job.result.companyName);
  const filename = `${name}_slides_${v}${lang === "en" ? "_EN" : ""}.pptx`;
  const buffer = await renderSkeletonPptxBuffer(skeleton, lang, v);
  return { buffer, filename };
}

/** Read a produced file (from storage) for download. */
export async function jobFileBuffer(
  job: Job,
  type: "docx" | "pptx" | "docx-en" | "pptx-en",
): Promise<{ buffer: Buffer; filename: string } | undefined> {
  if (!job.result) return undefined;
  const r = job.result;
  const map: Record<string, string | undefined> = {
    docx: r.files.scriptDocx,
    pptx: r.files.skeletonPptx,
    "docx-en": r.en?.files.scriptDocx,
    "pptx-en": r.en?.files.skeletonPptx,
  };
  const filename = map[type];
  if (!filename) return undefined;
  const buffer = await storage.getBinary(jobFileKey(job.id, filename));
  if (!buffer) return undefined;
  return { buffer, filename };
}

/** Drop the per-instance cache entry. Durable blobs are left to the store's
 * lifecycle (snapshots are tiny; not wired to a scheduler in M2). */
export function deleteJob(id: string) {
  jobs.delete(id);
}
