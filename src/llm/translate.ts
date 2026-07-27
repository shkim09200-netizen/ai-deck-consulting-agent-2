import { callTool, MODELS } from "./client.js";
import { scriptJsonSchema, scriptValidator, skeletonJsonSchema, skeletonValidator } from "./schemas.js";
import { finalizeScript, finalizeSkeleton } from "./pipeline.js";
import type { CompanyInput, ScriptDoc, SkeletonDoc } from "../domain/types.js";

/* ---------- English translation (§ on-demand EN version) ---------- */

function translateScriptSystem(): string {
  return [
    "You are a bilingual pitch-deck consultant. Translate a Korean demo-day presentation SCRIPT into natural, spoken English suitable for reading aloud on stage.",
    "Rules:",
    "- Return the SAME section/beats structure. Keep the `no`, `key`, and `click` fields exactly; only translate `title` and beat `text`.",
    "- Spoken, confident pitch English — not a written report. Short, clear sentences a presenter can say out loud.",
    "- Keep every number, unit, and proper noun (company/product names) unchanged.",
    "- Preserve any [CONFIRM: ...] markers verbatim in place (you may translate the note inside the brackets to English, keep the bracket format).",
    "- Do NOT add claims, statistics, or content that isn't in the Korean source.",
  ].join("\n");
}

function translateSkeletonSystem(): string {
  return [
    "You are a bilingual deck designer. Translate a Korean slide-design spec into English, keeping the exact same structure and layout.",
    "Rules:",
    "- Return the SAME slides array. Keep `no`, `sectionKey`, `layout`, `chart.type`, numeric values, `visual.kind`, `needsAsset`, `confirmed`, `scriptRefs`, and `offsets` unchanged.",
    "- Translate only human-readable text: eyebrow, headline, subhead, bullets[].text, metrics[].label/sub, columns[].heading/items, steps[].title/detail, team[].role/note, chart.title/unit/series[].name/categories, visual.direction, memo, speakerNotes.",
    "- Keep every number and metric value unchanged; only translate its label.",
    "- Preserve any [NEEDS INPUT: ...] markers verbatim in place (bracket format kept).",
    "- Do NOT invent data or change the design. Same accentColor.",
  ].join("\n");
}

export async function translateScript(script: ScriptDoc): Promise<ScriptDoc> {
  const payload = {
    sections: script.sections.map((s) => ({ no: s.no, key: s.key, title: s.title, beats: s.beats })),
  };
  const raw = await callTool({
    model: MODELS.generate,
    system: translateScriptSystem(),
    messages: [{ role: "user", content: `Translate this Korean script to English. Return the full sections array.\n\n${JSON.stringify(payload, null, 2)}` }],
    toolName: "emit_script",
    toolDescription: "Return the English-translated script in the same section/beats structure.",
    inputSchema: scriptJsonSchema,
    validator: scriptValidator,
    maxTokens: 14000,
  });
  return finalizeScript(raw.sections, script.companyName, script.presentationMinutes);
}

export async function translateSkeleton(skeleton: SkeletonDoc, input: CompanyInput): Promise<SkeletonDoc> {
  const payload = {
    accentColor: skeleton.accentColor,
    slides: skeleton.slides.map((sl) => ({
      no: sl.no, sectionKey: sl.sectionKey, layout: sl.layout, eyebrow: sl.eyebrow, headline: sl.headline,
      subhead: sl.subhead, bullets: sl.bullets, metrics: sl.metrics, columns: sl.columns, steps: sl.steps,
      team: sl.team, chart: sl.chart, visual: sl.visual, memo: sl.memo, speakerNotes: sl.speakerNotes, scriptRefs: sl.scriptRefs,
      offsets: sl.offsets,
    })),
  };
  const raw = await callTool({
    model: MODELS.generate,
    system: translateSkeletonSystem(),
    messages: [{ role: "user", content: `Translate this Korean slide spec to English. Return the full slides array unchanged in structure.\n\n${JSON.stringify(payload, null, 2)}` }],
    toolName: "emit_skeleton",
    toolDescription: "Return the English-translated slides in the same layout structure.",
    inputSchema: skeletonJsonSchema,
    validator: skeletonValidator,
    maxTokens: 30000,
  });
  return finalizeSkeleton(raw.slides, input, raw.accentColor ?? skeleton.accentColor, undefined, skeleton.variant);
}

export async function translateDeck(
  script: ScriptDoc,
  skeleton: SkeletonDoc,
  input: CompanyInput,
): Promise<{ script: ScriptDoc; skeleton: SkeletonDoc }> {
  const [en_script, en_skeleton] = await Promise.all([
    translateScript(script),
    translateSkeleton(skeleton, input),
  ]);
  return { script: en_script, skeleton: en_skeleton };
}
