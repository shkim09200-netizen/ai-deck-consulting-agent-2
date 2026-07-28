import { NextRequest } from "next/server";
import { getOrLoadJob, jobFileBuffer, renderVariantBuffer } from "@/lib/jobs";
import { DOCX_MIME, PPTX_MIME } from "@/lib/storage";

export const runtime = "nodejs";

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
  const out =
    variant && (type === "pptx" || type === "pptx-en")
      ? await renderVariantBuffer(job, variant, type === "pptx-en" ? "en" : "ko")
      : await jobFileBuffer(job, type as DlType);
  if (!out) return new Response("not found", { status: 404 });

  return new Response(new Uint8Array(out.buffer), {
    headers: {
      "Content-Type": type.startsWith("docx") ? DOCX_MIME : PPTX_MIME,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(out.filename)}`,
    },
  });
}
