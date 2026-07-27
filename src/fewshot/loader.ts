import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import mammoth from "mammoth";

export interface FewShotExample {
  name: string;
  text: string;
}

const DEFAULT_SAMPLES_DIR = path.resolve(process.cwd(), "samples", "scripts");

/**
 * §5.4 FEWSHOT_SAMPLES slot. Loads real approved scripts as style exemplars.
 * Returns [] gracefully if the slot is empty — the pipeline still works on
 * HOUSE_STYLE rules alone.
 */
export async function loadScriptExemplars(opts?: {
  dir?: string;
  maxExamples?: number;
  maxCharsEach?: number;
}): Promise<FewShotExample[]> {
  const dir = opts?.dir ?? DEFAULT_SAMPLES_DIR;
  const maxExamples = opts?.maxExamples ?? 2;
  const maxCharsEach = opts?.maxCharsEach ?? 2600;
  if (!existsSync(dir)) return [];

  const files = (await readdir(dir)).filter((f) => f.toLowerCase().endsWith(".docx") && !f.startsWith("~$"));
  // Prefer the shortest/cleanest files first — they tend to be single-version finals.
  const withSize = await Promise.all(
    files.map(async (f) => ({ f, size: (await readFile(path.join(dir, f))).byteLength })),
  );
  withSize.sort((a, b) => a.size - b.size);

  const out: FewShotExample[] = [];
  for (const { f } of withSize.slice(0, maxExamples)) {
    try {
      const { value } = await mammoth.extractRawText({ path: path.join(dir, f) });
      const text = value.trim();
      if (!text) continue;
      out.push({ name: cleanName(f), text: text.slice(0, maxCharsEach) });
    } catch {
      /* skip unreadable */
    }
  }
  return out;
}

function cleanName(f: string): string {
  return f
    .replace(/^Copy of\s*/i, "")
    .replace(/\[Demoday\d+\]/i, "")
    .replace(/Script[_ ]?/i, "")
    .replace(/_?Final ?version/i, "")
    .replace(/\.docx$/i, "")
    .trim();
}

export function renderExemplars(examples: FewShotExample[]): string {
  if (examples.length === 0) return "";
  const blocks = examples
    .map((e, i) => `--- 예시 ${i + 1} (${e.name}) ---\n${e.text}`)
    .join("\n\n");
  return `아래는 승인된 우수 스크립트 예시다. 구조·어조·(click) 사용·숫자 밀도를 참고하되, 내용은 절대 복사하지 말고 현재 회사 정보만으로 작성하라.\n\n${blocks}`;
}
