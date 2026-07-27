import { NextRequest } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getOrLoadJob, jobFilePath, renderVariantPptx } from "@/lib/jobs";

export const runtime = "nodejs";

const MIME: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

const ALLOWED = ["docx", "pptx", "docx-en", "pptx-en"] as const;
type DlType = (typeof ALLOWED)[number];

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; type: string }> }) {
  const { id, type } = await params;
  if (!ALLOWED.includes(type as DlType)) {
    return new Response("bad type", { status: 400 });
  }
  const job = await getOrLoadJob(id);
  if (!job || !job.result) return new Response("not ready", { status: 404 });

  // pptx downloads may request a specific design variant (minimal/bold/editorial)
  const variant = req.nextUrl.searchParams.get("variant");
  let filePath: string | undefined;
  if (variant && (type === "pptx" || type === "pptx-en")) {
    filePath = await renderVariantPptx(job, variant, type === "pptx-en" ? "en" : "ko");
  } else {
    filePath = jobFilePath(job, type as DlType);
  }
  if (!filePath) return new Response("not found", { status: 404 });

  const buf = await readFile(filePath);
  const fname = path.basename(filePath);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": MIME[type.startsWith("docx") ? "docx" : "pptx"]!,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fname)}`,
    },
  });
}
