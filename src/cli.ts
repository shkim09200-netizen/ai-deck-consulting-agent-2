import { readdir, mkdir, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { parseFile, parseUrl, type ParsedSource } from "./ingestion/parse.js";
import { extractCompanyInput, getClarifications, generateScript, generateSkeleton, reviewDeck } from "./llm/pipeline.js";
import { writeScriptDocx } from "./render/docx.js";
import { writeSkeletonPptx } from "./render/pptx.js";
import { buildTracker, renderTracker } from "./domain/flags.js";
import { hasApiKey } from "./llm/client.js";
import type { CompanyInput, ScriptDoc } from "./domain/types.js";

interface Args { input?: string; url?: string; out: string; approve: boolean; version: string; }

function parseArgs(argv: string[]): Args {
  const a: Args = { out: "out", approve: false, version: "0.1" };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]!;
    if (t === "--url") a.url = argv[++i];
    else if (t === "--out") a.out = argv[++i]!;
    else if (t === "--approve" || t === "--all") a.approve = true;
    else if (t === "--version") a.version = argv[++i]!;
    else if (!t.startsWith("--")) a.input = t;
  }
  return a;
}

async function collectSources(args: Args): Promise<ParsedSource[]> {
  const sources: ParsedSource[] = [];
  if (args.input) {
    const st = statSync(args.input);
    const files = st.isDirectory()
      ? (await readdir(args.input)).filter((f) => !f.startsWith("~$")).map((f) => path.join(args.input!, f))
      : [args.input];
    for (const f of files) {
      try { sources.push(await parseFile(f)); console.log(`  ✓ parsed ${path.basename(f)}`); }
      catch (e) { console.warn(`  ✗ skip ${path.basename(f)}: ${(e as Error).message}`); }
    }
  }
  if (args.url) { sources.push(await parseUrl(args.url)); console.log(`  ✓ fetched ${args.url}`); }
  return sources;
}

function safeName(s: string): string { return s.replace(/[\\/:*?"<>|]/g, "_").trim() || "company"; }

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input && !args.url) {
    console.log("usage: npm run generate -- <file|dir> [--url URL] [--out DIR] [--approve] [--version 0.1]");
    process.exit(1);
  }
  if (!hasApiKey()) {
    console.error("\n⚠ ANTHROPIC_API_KEY 가 설정되지 않았습니다. 생성 단계를 실행할 수 없습니다.");
    console.error("  PowerShell:  $env:ANTHROPIC_API_KEY = 'sk-...'  후 다시 실행하세요.\n");
    process.exit(2);
  }
  await mkdir(args.out, { recursive: true });

  console.log("\n[1/5] 자료 파싱");
  const sources = await collectSources(args);
  if (sources.length === 0) { console.error("파싱된 자료가 없습니다."); process.exit(1); }

  console.log("\n[2/5] 회사 정보 추출 (Ingestion)");
  const input: CompanyInput = await extractCompanyInput(sources);
  const name = safeName(input.companyName);
  await writeFile(path.join(args.out, `${name}_input.json`), JSON.stringify(input, null, 2));
  console.log(`  회사명: ${input.companyName} | 발표 ${input.meta.presentationMinutes}분`);

  console.log("\n[2.5] 명확화 질문 체크 (환각 방지 게이트)");
  const { questions } = await getClarifications(input);
  if (questions.length) {
    console.log("  ⚠ 스크립트 전에 확인이 필요한 항목:");
    questions.forEach((q, i) => console.log(`    ${i + 1}. ${q}`));
    console.log("  (자료를 보완하거나, 그대로 진행하려면 계속 — 미확인 항목은 [CONFIRM]으로 표기됩니다.)");
  } else {
    console.log("  ✓ 추가 질문 없음");
  }

  console.log("\n[3/5] Step 1 — Script 생성");
  const script: ScriptDoc = await generateScript(input);
  const scriptPath = path.join(args.out, `${name}_script_v${args.version}.docx`);
  await writeScriptDocx(script, scriptPath);
  console.log(`  ✓ ${scriptPath}  (${script.sections.length} 섹션)`);

  // ---- Approval gate (§ Quality Guardrail #1) ----
  if (!args.approve) {
    console.log("\n" + "─".repeat(56));
    console.log("승인 게이트: Script를 검토·승인하기 전에는 Skeleton을 생성하지 않습니다.");
    console.log(renderTracker(buildTracker(script)));
    console.log("\n검토 후 Skeleton까지 생성하려면 --approve 플래그로 다시 실행하세요.");
    console.log("─".repeat(56));
    return;
  }

  console.log("\n[4/5] Step 2 — Skeleton 생성 (승인됨)");
  const skeleton = await generateSkeleton(input, script);
  const pptxPath = path.join(args.out, `${name}_skeleton_v${args.version}.pptx`);
  await writeSkeletonPptx(skeleton, pptxPath);
  console.log(`  ✓ ${pptxPath}  (${skeleton.slides.length} 슬라이드)`);

  console.log("\n[5/5] AI Review + 통합 미해결 트래커");
  const review = await reviewDeck(script, skeleton);
  if (review.items.length) {
    for (const it of review.items) console.log(`  [${it.severity}] (${it.category}) ${it.locationRef}: ${it.message}`);
  } else {
    console.log("  ✓ 리뷰 지적사항 없음");
  }
  console.log("\n" + renderTracker(buildTracker(script, skeleton)));
  console.log(`\n완료. 산출물: ${args.out}/`);
}

main().catch((e) => { console.error(e); process.exit(1); });
