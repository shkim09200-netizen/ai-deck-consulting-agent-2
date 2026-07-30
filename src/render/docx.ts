import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from "docx";
import { writeFile } from "node:fs/promises";
import type { ScriptDoc } from "../domain/types.js";

const PT = (n: number) => n * 2; // docx uses half-points

/** Split a beat into runs, highlighting [CONFIRM: ...]. */
function beatRuns(text: string): TextRun[] {
  const runs: TextRun[] = [];
  const re = /\[CONFIRM:[^\]]*\]/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const idx = m.index!;
    if (idx > last) runs.push(new TextRun({ text: text.slice(last, idx), size: PT(11) }));
    runs.push(new TextRun({ text: m[0], size: PT(11), bold: true, highlight: "yellow" }));
    last = idx + m[0].length;
  }
  if (last < text.length) runs.push(new TextRun({ text: text.slice(last), size: PT(11) }));
  return runs;
}

export function buildScriptDocument(doc: ScriptDoc, lang: "ko" | "en" = "ko"): Document {
  const t = lang === "en"
    ? { title: `${doc.companyName} — Presentation Script`, dur: `Duration ${doc.presentationMinutes} min` }
    : { title: `${doc.companyName} — 발표 스크립트`, dur: `발표 시간 ${doc.presentationMinutes}분` };
  const children: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: t.title, bold: true, size: PT(16) })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: t.dur, size: PT(10), color: "666666" })],
    }),
    new Paragraph({ text: "" }),
  ];

  for (const s of doc.sections) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: `슬라이드 ${s.no} — ${s.title}`, bold: true, size: PT(13) })],
      }),
    );
    for (const b of s.beats) {
      children.push(new Paragraph({ spacing: { after: 60 }, children: beatRuns(b.text) }));
    }
    children.push(new Paragraph({ text: "" }));
  }

  return new Document({
    styles: { default: { document: { run: { font: "맑은 고딕", size: PT(11) } } } },
    sections: [{ children }],
  });
}

/** Render the script to a docx Buffer (no disk) — used on serverless. */
export async function renderScriptDocxBuffer(doc: ScriptDoc, lang: "ko" | "en" = "ko"): Promise<Buffer> {
  return Packer.toBuffer(buildScriptDocument(doc, lang));
}

export async function writeScriptDocx(doc: ScriptDoc, outPath: string, lang: "ko" | "en" = "ko"): Promise<string> {
  await writeFile(outPath, await renderScriptDocxBuffer(doc, lang));
  return outPath;
}
