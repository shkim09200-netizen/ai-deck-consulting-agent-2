import { NextRequest, NextResponse } from "next/server";
import { listProjects, createProject, ownerFromRequest } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return NextResponse.json(await listProjects(ownerFromRequest(req)));
}

export async function POST(req: NextRequest) {
  let body: { company_name?: string; folder_id?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 본문입니다." }, { status: 400 });
  }
  const name = (body.company_name ?? "").trim();
  if (!name) return NextResponse.json({ error: "회사명을 입력하세요." }, { status: 400 });
  try {
    const project = await createProject(ownerFromRequest(req), name, body.folder_id ?? null);
    return NextResponse.json(project);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const hint = /EROFS|read-only|EACCES|EPERM|ENOENT/i.test(msg)
      ? " — 서버 디스크에 쓸 수 없습니다. 쓰기 가능한 디스크가 있는 서버(예: Railway)가 필요합니다."
      : "";
    return NextResponse.json({ error: `덱을 만들지 못했습니다: ${msg}${hint}` }, { status: 500 });
  }
}
