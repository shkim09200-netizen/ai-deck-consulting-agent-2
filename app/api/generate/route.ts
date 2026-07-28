import { NextRequest, NextResponse } from "next/server";
import { createJob, snapshot } from "@/lib/jobs";
import { ownerFromRequest } from "@/lib/store";
import { storage } from "@/lib/storage";
import { hasApiKey } from "@engine/llm/client.js";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  if (!hasApiKey()) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY 가 서버에 설정되지 않았습니다. (Vercel: Settings → Environment Variables 에서 Production 에 키를 추가하고 재배포 / 로컬: .env.local)" },
      { status: 400 },
    );
  }

  const form = await req.formData();
  const entries = form.getAll("files");
  const files: Array<{ name: string; buffer: Buffer }> = [];
  for (const e of entries) {
    if (e instanceof File) {
      const buf = Buffer.from(await e.arrayBuffer());
      files.push({ name: e.name, buffer: buf });
    }
  }

  // Large files were uploaded straight to object storage (to dodge the 4.5MB
  // request limit) and referenced here by key — read them back into buffers.
  const uploadRefsRaw = form.get("uploadRefs");
  if (typeof uploadRefsRaw === "string" && uploadRefsRaw.trim()) {
    try {
      const refs = JSON.parse(uploadRefsRaw) as Array<{ name: string; key: string }>;
      for (const r of refs) {
        const buf = await storage.getBinary(r.key);
        if (buf) files.push({ name: r.name, buffer: buf });
      }
    } catch {
      /* malformed uploadRefs — ignore */
    }
  }

  const directives = (form.get("directives") as string | null)?.trim() || undefined;
  const projectId = (form.get("projectId") as string | null)?.trim() || undefined;
  const urls = ((form.get("urls") as string | null) ?? "")
    .split(/[\s,]+/)
    .map((u) => u.trim())
    .filter((u) => /^https?:\/\//i.test(u));

  if (files.length === 0 && urls.length === 0) {
    return NextResponse.json({ error: "업로드된 파일이나 웹사이트 링크가 없습니다." }, { status: 400 });
  }

  try {
    // Runs the full pipeline synchronously (bounded by maxDuration) and returns
    // the finished snapshot — no fire-and-forget/SSE, which can't survive a
    // serverless invocation. The client shows progress locally while it waits.
    const job = await createJob(files, { directives, urls, projectId, owner: ownerFromRequest(req) });
    return NextResponse.json(snapshot(job));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Most likely a read-only filesystem (e.g. serverless hosts like Vercel):
    // this app needs a writable disk. Surface the real reason instead of a
    // bare 500 so the failure is diagnosable from the UI.
    const hint = /EROFS|read-only|EACCES|EPERM|ENOENT/i.test(msg)
      ? " — 서버 디스크에 쓸 수 없습니다. 이 앱은 쓰기 가능한 디스크가 있는 서버(예: Railway)가 필요합니다."
      : "";
    return NextResponse.json({ error: `생성을 시작하지 못했습니다: ${msg}${hint}` }, { status: 500 });
  }
}
