import { readFile } from "node:fs/promises";
import path from "node:path";
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import * as XLSX from "xlsx";

export interface ParsedSource {
  name: string;
  kind: "prev_deck" | "onepager" | "ir" | "website" | "image" | "spreadsheet" | "other";
  /** extracted text (empty for images) */
  text: string;
  /** for images: base64 + media type, fed to Claude vision */
  image?: { base64: string; mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp" };
}

const IMAGE_EXT: Record<string, ParsedSource["image"] extends infer I ? I extends { mediaType: infer M } ? M : never : never> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/** Parse an already-loaded file buffer. Preferred on serverless where uploads
 * live in memory (never touch disk). `name` is used only for the extension. */
export async function parseBuffer(name: string, buffer: Buffer): Promise<ParsedSource> {
  const base = path.basename(name);
  const ext = path.extname(base).toLowerCase();

  if (ext === ".docx") {
    const { value } = await mammoth.extractRawText({ buffer });
    return { name: base, kind: "other", text: value.trim() };
  }
  if (ext === ".pdf") {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: true });
    return { name: base, kind: "ir", text: (Array.isArray(text) ? text.join("\n") : text).trim() };
  }
  if (ext === ".xlsx" || ext === ".xls" || ext === ".csv") {
    const wb = XLSX.read(buffer, { type: "buffer" });
    const parts: string[] = [];
    for (const sheet of wb.SheetNames) {
      parts.push(`# ${sheet}\n${XLSX.utils.sheet_to_csv(wb.Sheets[sheet]!)}`);
    }
    return { name: base, kind: "spreadsheet", text: parts.join("\n\n").trim() };
  }
  if (ext in IMAGE_EXT) {
    return {
      name: base,
      kind: "image",
      text: "",
      image: { base64: buffer.toString("base64"), mediaType: IMAGE_EXT[ext]! },
    };
  }
  if (ext === ".pptx") {
    return { name: base, kind: "prev_deck", text: (await extractPptxText(buffer)).trim() };
  }
  if (ext === ".txt" || ext === ".md") {
    return { name: base, kind: "other", text: buffer.toString("utf-8").trim() };
  }
  // unknown formats: note it so the model knows a source was skipped.
  return { name: base, kind: "other", text: `[미지원 형식 ${ext} — 파싱 생략]` };
}

/** Parse a file from disk (used by the CLI / tests). Delegates to parseBuffer. */
export async function parseFile(filePath: string): Promise<ParsedSource> {
  const buf = await readFile(filePath);
  return parseBuffer(path.basename(filePath), buf);
}

/** Extract per-slide text from a .pptx (Open XML) using its zip container. */
async function extractPptxText(buf: Buffer): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buf);
  const slideFiles = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)\.xml$/)![1]);
      const nb = Number(b.match(/slide(\d+)\.xml$/)![1]);
      return na - nb;
    });
  const out: string[] = [];
  for (let i = 0; i < slideFiles.length; i++) {
    const xml = await zip.files[slideFiles[i]!]!.async("string");
    // <a:t> holds run text; join runs, collapse whitespace
    const runs = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) =>
      m[1]!.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'"),
    );
    const text = runs.join(" ").replace(/\s+/g, " ").trim();
    if (text) out.push(`# Slide ${i + 1}\n${text}`);
  }
  return out.join("\n\n");
}

/** Fetch a URL and extract readable body text (§ website source). */
export async function parseUrl(url: string): Promise<ParsedSource> {
  const res = await fetch(url, { headers: { "user-agent": "deck-agent/0.1" } });
  const html = await res.text();
  // lazy-import readability/jsdom to keep startup light
  const { JSDOM } = await import("jsdom");
  const { Readability } = await import("@mozilla/readability");
  const dom = new JSDOM(html, { url });
  const article = new Readability(dom.window.document).parse();
  const text = (article?.textContent ?? dom.window.document.body?.textContent ?? "").trim();
  return { name: url, kind: "website", text: text.slice(0, 20000) };
}
