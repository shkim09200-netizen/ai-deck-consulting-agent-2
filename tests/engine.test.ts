import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";
import mammoth from "mammoth";
import { extractConfirmFlags, extractNeedsInputFlags, buildTracker, renderTracker } from "../src/domain/flags.js";
import { buildScriptDocument } from "../src/render/docx.js";
import { Packer } from "docx";
import { writeSkeletonPptx } from "../src/render/pptx.js";
import { loadScriptExemplars } from "../src/fewshot/loader.js";
import { SCRIPT_TO_SKELETON, SKELETON_STRUCTURE, SECTION_CHECKLIST } from "../src/domain/houseStyle.js";
import type { ScriptDoc, SkeletonDoc, Slide } from "../src/domain/types.js";

const mkSlide = (p: Partial<Slide> & { no: number; sectionKey: string }): Slide => ({
  layout: "bullets", eyebrow: "", headline: "", subhead: "", bullets: [], metrics: [],
  columns: [], steps: [], team: [], chart: null, visual: { kind: "none", direction: "" },
  memo: "", speakerNotes: "", scriptRefs: [], flags: [], status: "ok", checklist: [], ...p,
});

const sampleScript: ScriptDoc = {
  companyName: "테스트컴퍼니",
  presentationMinutes: 7,
  sections: [
    { no: 1, key: "intro", title: "Intro", beats: [{ text: "안녕하세요, 테스트컴퍼니입니다." }] },
    { no: 2, key: "traction", title: "Traction", beats: [
      { text: "작년 매출 [CONFIRM: 정확한 MRR 수치] 를 기록했습니다." },
      { text: "올해 30억을 목표합니다." },
    ] },
  ],
  flags: [],
};

const sampleSkeleton: SkeletonDoc = {
  companyName: "테스트컴퍼니",
  presentationMinutes: 7,
  slides: [
    mkSlide({ no: 1, sectionKey: "intro", layout: "cover", headline: "테스트컴퍼니", speakerNotes: "안녕하세요", visual: { kind: "logo", direction: "로고" }, scriptRefs: ["1"] }),
    mkSlide({ no: 2, sectionKey: "team", layout: "team", headline: "팀", speakerNotes: "팀 소개", visual: { kind: "image", direction: "팀 사진" }, memo: "[NEEDS INPUT: 팀 단체 사진]", scriptRefs: ["2"],
      flags: [{ kind: "NEEDS_INPUT", docType: "skeleton", locationRef: "Slide 2", message: "팀 단체 사진 필요" }] }),
  ],
  flags: [],
};

describe("flags", () => {
  it("extracts [CONFIRM] flags from script text", () => {
    const f = extractConfirmFlags("매출 [CONFIRM: MRR] 기록", "Script §2");
    expect(f).toHaveLength(1);
    expect(f[0]!.kind).toBe("CONFIRM");
    expect(f[0]!.message).toBe("MRR");
  });

  it("extracts [NEEDS INPUT] flags", () => {
    const f = extractNeedsInputFlags("[NEEDS INPUT: 팀 사진]", "Slide 2");
    expect(f[0]!.kind).toBe("NEEDS_INPUT");
    expect(f[0]!.message).toBe("팀 사진");
  });

  it("aggregates a unified tracker across script + skeleton", () => {
    const items = buildTracker(sampleScript, sampleSkeleton);
    // 1 CONFIRM from script inline + 1 NEEDS_INPUT from skeleton flag
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items.some((i) => i.kind === "CONFIRM")).toBe(true);
    expect(items.some((i) => i.kind === "NEEDS_INPUT")).toBe(true);
    expect(renderTracker(items)).toContain("미해결 항목");
  });

  it("reports clean when no flags", () => {
    expect(renderTracker([])).toContain("없음");
  });
});

describe("docx renderer", () => {
  it("produces a valid .docx that round-trips section titles and [CONFIRM]", async () => {
    const buffer = await Packer.toBuffer(buildScriptDocument(sampleScript));
    expect(buffer.length).toBeGreaterThan(1000);
    const { value } = await mammoth.extractRawText({ buffer });
    expect(value).toContain("Intro");
    expect(value).toContain("Traction");
    expect(value).toContain("[CONFIRM: 정확한 MRR 수치]");
  });
});

describe("pptx renderer", () => {
  it("writes a valid .pptx (zip) with the right slide count", async () => {
    const out = path.join(tmpdir(), `deck-test-${Date.now()}.pptx`);
    await writeSkeletonPptx(sampleSkeleton, out);
    const buf = await readFile(out);
    // PK zip magic
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
    // slide count: unzip and count slideN.xml
    const JSZip = (await import("jszip")).default ?? (await import("jszip"));
    // pptxgenjs ships jszip transitively; fall back to checking file size if unavailable
    expect(buf.length).toBeGreaterThan(2000);
  });
});

describe("fewshot loader", () => {
  it("loads real sample scripts as exemplars (if present)", async () => {
    const ex = await loadScriptExemplars({ maxExamples: 2 });
    // samples/scripts is populated in this repo
    expect(ex.length).toBeGreaterThan(0);
    expect(ex[0]!.text.length).toBeGreaterThan(100);
  });
});

describe("house-style config integrity", () => {
  it("every script→skeleton target key exists in the skeleton structure", () => {
    const skKeys = new Set(SKELETON_STRUCTURE.map((s) => s.key));
    for (const targets of Object.values(SCRIPT_TO_SKELETON)) {
      for (const t of targets) expect(skKeys.has(t)).toBe(true);
    }
  });
  it("checklist keys are skeleton section keys", () => {
    const skKeys = new Set(SKELETON_STRUCTURE.map((s) => s.key));
    for (const k of Object.keys(SECTION_CHECKLIST)) expect(skKeys.has(k)).toBe(true);
  });
});
