import { NextRequest, NextResponse } from "next/server";
import { moveProject, ownerFromRequest } from "@/lib/store";

export const runtime = "nodejs";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { folder_id?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 본문입니다." }, { status: 400 });
  }
  const project = await moveProject(ownerFromRequest(req), id, body.folder_id ?? null);
  if (!project) return NextResponse.json({ error: "덱을 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json(project);
}
