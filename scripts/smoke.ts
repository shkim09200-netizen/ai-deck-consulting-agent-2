import { parseFile } from "../src/ingestion/parse.js";
import { extractCompanyInput, generateScript, generateSkeleton } from "../src/llm/pipeline.js";
import { translateSkeleton } from "../src/llm/translate.js";
import { writeSkeletonPptx } from "../src/render/pptx.js";
import { readFile } from "node:fs/promises";
import path from "node:path";

const PDF = process.argv[2] ?? "samples/ir/4. 젤코_IR Deck.pdf";

async function main() {
  console.log("parse:", PDF);
  const src = await parseFile(PDF);
  console.log("  text chars:", src.text.length, "kind:", src.kind);

  console.log("ingest…");
  const input = await extractCompanyInput([src], "발표 7분 기준, 슬라이드 12장 내외. Traction을 강조.");
  console.log("  company:", input.companyName, "| minutes:", input.meta.presentationMinutes);

  console.log("script…");
  const script = await generateScript(input, { directives: "발표 7분 기준. Traction 강조." });
  console.log("  sections:", script.sections.length, script.sections.map((s) => s.title).join(", "));

  console.log("skeleton…");
  const skeleton = await generateSkeleton(input, script, { directives: "슬라이드 12장 내외." });
  console.log("  accent:", skeleton.accentColor, "| slides:", skeleton.slides.length);
  const layoutCount: Record<string, number> = {};
  let charts = 0, metrics = 0, comparisons = 0;
  for (const sl of skeleton.slides) {
    layoutCount[sl.layout] = (layoutCount[sl.layout] ?? 0) + 1;
    if (sl.chart) charts++;
    if (sl.metrics.length) metrics++;
    if (sl.columns.length) comparisons++;
  }
  console.log("  layouts:", JSON.stringify(layoutCount));
  console.log("  slides w/ chart:", charts, "| metrics:", metrics, "| comparison cols:", comparisons);
  console.log("  sample slide[2]:", JSON.stringify(skeleton.slides[2], null, 2)?.slice(0, 900));

  const out = path.join(process.cwd(), ".data", "_smoke.pptx");
  await writeSkeletonPptx(skeleton, out);
  const buf = await readFile(out);
  console.log("pptx:", out, "bytes:", buf.length, "zip-ok:", buf[0] === 0x50 && buf[1] === 0x4b);

  console.log("translate skeleton → EN…");
  const en = await translateSkeleton(skeleton, input);
  console.log("  EN slide[0] headline:", en.slides[0]?.headline);
  console.log("  EN slide[2] headline:", en.slides[2]?.headline);
  const outEn = path.join(process.cwd(), ".data", "_smoke_EN.pptx");
  await writeSkeletonPptx(en, outEn, "en");
  console.log("pptx EN written:", outEn);

  console.log("\n✅ SMOKE OK");
}
main().catch((e) => { console.error("SMOKE FAILED:", e); process.exit(1); });
