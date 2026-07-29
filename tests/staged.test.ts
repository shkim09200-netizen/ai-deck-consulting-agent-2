import { describe, it, expect, vi } from "vitest";
import { tmpdir } from "node:os";
import path from "node:path";

// Point the storage adapter at a temp dir (filesystem backend) BEFORE the app
// modules load, and make sure the Blob backend is not selected.
process.env.DECK_DATA_DIR = path.join(tmpdir(), `deck-staged-${process.pid}`);
delete process.env.BLOB_READ_WRITE_TOKEN;

// Stub the LLM pipeline + renderers so the staged state machine is exercised
// deterministically and offline.
vi.mock("@engine/llm/pipeline.js", () => ({
  extractCompanyInput: vi.fn(async () => ({ companyName: "테스트컴퍼니", meta: { presentationMinutes: 7 } }) as any),
  analyzeGaps: vi.fn(async () => ({ missingSections: [], orderIssues: [] }) as any),
  getClarifications: vi.fn(async () => ({ questions: ["질문?"] }) as any),
  generateScript: vi.fn(async () =>
    ({ companyName: "테스트컴퍼니", presentationMinutes: 7, sections: [{ no: 1, key: "intro", title: "Intro", beats: [] }], flags: [] }) as any),
  generateSkeleton: vi.fn(async () =>
    ({ companyName: "테스트컴퍼니", presentationMinutes: 7, variant: "minimal", slides: [], flags: [] }) as any),
  reviewDeck: vi.fn(async () => ({ items: [] }) as any),
  alignScriptToSlides: (skeleton: any, companyName: string, presentationMinutes: number) =>
    ({
      companyName,
      presentationMinutes,
      sections: (skeleton.slides ?? []).map((sl: any) => ({ no: sl.no, key: sl.sectionKey, title: sl.headline ?? "", beats: [] })),
      flags: [],
    }) as any,
}));
vi.mock("@engine/render/docx.js", () => ({ renderScriptDocxBuffer: vi.fn(async () => Buffer.from("DOCX")) }));
vi.mock("@engine/render/pptx.js", () => ({ renderSkeletonPptxBuffer: vi.fn(async () => Buffer.from("PPTX")) }));

describe("staged generation (serverless-safe)", () => {
  it("createJob → advance×N reaches done, persisting across simulated instances", async () => {
    const { createJob, advanceJob, getOrLoadJob, jobFileBuffer, snapshot } = await import("@/lib/jobs");
    const g = globalThis as unknown as { __deckJobs?: Map<string, unknown> };

    const job = await createJob([{ name: "note.txt", buffer: Buffer.from("빔스튜디오 AI 영상") }], {});
    expect(job.status).toBe("running");
    expect(job.phase).toBe("ingested");
    const id = job.id;

    // Drive the pipeline like the API route does, clearing the per-instance
    // cache before each step so the job MUST come from durable storage.
    let s = snapshot(job);
    let guard = 0;
    while (s.status === "running" && guard++ < 10) {
      g.__deckJobs?.clear();
      const loaded = await getOrLoadJob(id);
      expect(loaded).toBeDefined();
      s = snapshot(await advanceJob(loaded!));
    }

    expect(guard).toBeLessThanOrEqual(4); // ingested → scripted → skeletoned → done
    expect(s.status).toBe("done");
    expect(s.result?.files.skeletonPptx).toMatch(/\.pptx$/);
    expect(s.result?.clarifications).toContain("질문?");

    // Files were persisted to storage and are downloadable after cache loss.
    g.__deckJobs?.clear();
    const reloaded = await getOrLoadJob(id);
    const dl = await jobFileBuffer(reloaded!, "pptx");
    expect(dl?.buffer.toString()).toBe("PPTX");
  });
});
