import type { Flag, ScriptDoc, SkeletonDoc } from "./types.js";

const CONFIRM_RE = /\[CONFIRM:\s*([^\]]+)\]/g;
const NEEDS_INPUT_RE = /\[NEEDS INPUT:\s*([^\]]*)\]/g;

/** Extract inline [CONFIRM: ...] flags from a chunk of script text. */
export function extractConfirmFlags(text: string, locationRef: string): Flag[] {
  const out: Flag[] = [];
  for (const m of text.matchAll(CONFIRM_RE)) {
    out.push({ kind: "CONFIRM", docType: "script", locationRef, message: m[1]!.trim() });
  }
  return out;
}

export function extractNeedsInputFlags(text: string, locationRef: string): Flag[] {
  const out: Flag[] = [];
  for (const m of text.matchAll(NEEDS_INPUT_RE)) {
    out.push({ kind: "NEEDS_INPUT", docType: "skeleton", locationRef, message: (m[1] ?? "").trim() || locationRef });
  }
  return out;
}

/**
 * §9 — unified tracker. Aggregates every open flag across Script + Skeleton
 * into one ordered list a founder can resolve in one place.
 */
export interface TrackerItem {
  index: number;
  kind: Flag["kind"];
  locationRef: string;
  message: string;
}

export function buildTracker(script?: ScriptDoc, skeleton?: SkeletonDoc): TrackerItem[] {
  const flags: Flag[] = [
    ...(script?.flags ?? []),
    ...(script?.sections.flatMap((s) =>
      s.beats.flatMap((b) => extractConfirmFlags(b.text, `Script §${s.no} (${s.title})`)),
    ) ?? []),
    ...(skeleton?.flags ?? []),
    ...(skeleton?.slides.flatMap((sl) => sl.flags) ?? []),
  ];
  // de-dupe by (kind, locationRef, message)
  const seen = new Set<string>();
  const items: TrackerItem[] = [];
  for (const f of flags) {
    const k = `${f.kind}|${f.locationRef}|${f.message}`;
    if (seen.has(k)) continue;
    seen.add(k);
    items.push({ index: items.length + 1, kind: f.kind, locationRef: f.locationRef, message: f.message });
  }
  return items;
}

export function renderTracker(items: TrackerItem[]): string {
  if (items.length === 0) return "✅ 미해결 항목 없음";
  const lines = items.map(
    (it) => `  ${it.index}) [${it.kind === "CONFIRM" ? "확인필요" : "자료필요"}] ${it.message} — ${it.locationRef}`,
  );
  return `미해결 항목 (${items.length}):\n${lines.join("\n")}`;
}
