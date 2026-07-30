import { describe, it, expect } from "vitest";
import { finalizeScript, finalizeSkeleton } from "../src/llm/pipeline.js";
import { buildTracker } from "../src/domain/flags.js";
import { CompanyInputSchema } from "../src/domain/types.js";

type RawSlide = Parameters<typeof finalizeSkeleton>[0][number];
const mkRaw = (p: Partial<RawSlide> & { no: number; sectionKey: string }): RawSlide => ({
  layout: "bullets", eyebrow: "", headline: "", subhead: "", bullets: [], metrics: [],
  columns: [], steps: [], team: [], chart: null, visual: { kind: "none", direction: "" },
  memo: "", speakerNotes: "", scriptRefs: [], ...p,
});

/**
 * The Window 2 edit + export path re-runs finalizeScript/finalizeSkeleton on
 * edited content (both for AI edits and for deterministic re-render). These
 * cover that shared path without needing an API key.
 */
describe("edit finalize helpers", () => {
  it("finalizeScript renumbers sections 1..N and re-extracts [CONFIRM]", () => {
    const doc = finalizeScript(
      [
        { key: "intro", title: "Intro", beats: [{ text: "안녕하세요" }] },
        { key: "traction", title: "Traction", beats: [{ text: "매출 [CONFIRM: MRR] 기록" }] },
      ],
      "테스트컴퍼니",
      7,
    );
    expect(doc.sections.map((s) => s.no)).toEqual([1, 2]);
    expect(doc.companyName).toBe("테스트컴퍼니");
    expect(doc.flags.some((f) => f.kind === "CONFIRM" && f.message === "MRR")).toBe(true);
  });

  it("finalizeSkeleton renumbers slides and derives [NEEDS INPUT] from edited memo", () => {
    const input = CompanyInputSchema.parse({ companyName: "테스트컴퍼니" }); // empty traction
    const sk = finalizeSkeleton(
      [
        mkRaw({ no: 1, sectionKey: "intro", layout: "cover", headline: "로고", scriptRefs: ["1"] }),
        mkRaw({ no: 2, sectionKey: "traction", layout: "metrics", memo: "[NEEDS INPUT: 매출 그래프]", scriptRefs: ["2"] }),
      ],
      input,
    );
    expect(sk.slides.map((s) => s.no)).toEqual([1, 2]);
    expect(sk.slides[1]!.flags.some((f) => f.message.includes("매출 그래프"))).toBe(true);
    // traction slide with no data → checklist flag surfaces (§4.5)
    expect(sk.slides[1]!.flags.some((f) => f.kind === "NEEDS_INPUT")).toBe(true);
  });

  it("an edited beat flows through finalize into the unified tracker", () => {
    const script = finalizeScript(
      [{ key: "problem", title: "Problem", beats: [{ text: "고객이 [CONFIRM: 몇 명] 있습니다" }] }],
      "테스트컴퍼니",
      7,
    );
    const input = CompanyInputSchema.parse({ companyName: "테스트컴퍼니" });
    const skeleton = finalizeSkeleton(
      [mkRaw({ no: 1, sectionKey: "problem", layout: "bullets", scriptRefs: ["1"] })],
      input,
    );
    const tracker = buildTracker(script, skeleton);
    expect(tracker.some((t) => t.kind === "CONFIRM" && t.message === "몇 명")).toBe(true);
  });
});
