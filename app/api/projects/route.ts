import { NextRequest, NextResponse } from "next/server";
import { listProjects, createProject } from "@/lib/store";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await listProjects());
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
  const project = await createProject(name, body.folder_id ?? null);
  return NextResponse.json(project);
}
