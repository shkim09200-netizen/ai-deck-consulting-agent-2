import { NextRequest, NextResponse } from "next/server";
import { createJob } from "@/lib/jobs";
import { hasApiKey } from "@engine/llm/client.js";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  if (!hasApiKey()) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY 가 서버에 설정되지 않았습니다. .env.local 에 키를 넣고 서버를 재시작하세요." },
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

  const directives = (form.get("directives") as string | null)?.trim() || undefined;
  const projectId = (form.get("projectId") as string | null)?.trim() || undefined;
  const urls = ((form.get("urls") as string | null) ?? "")
    .split(/[\s,]+/)
    .map((u) => u.trim())
    .filter((u) => /^https?:\/\//i.test(u));

  if (files.length === 0 && urls.length === 0) {
    return NextResponse.json({ error: "업로드된 파일이나 웹사이트 링크가 없습니다." }, { status: 400 });
  }

  const job = await createJob(files, { directives, urls, projectId });
  return NextResponse.json({ jobId: job.id });
}
