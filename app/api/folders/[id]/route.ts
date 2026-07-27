import { NextRequest, NextResponse } from "next/server";
import { renameFolder, deleteFolder } from "@/lib/store";

export const runtime = "nodejs";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 본문입니다." }, { status: 400 });
  }
  const name = (body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "폴더 이름을 입력하세요." }, { status: 400 });
  const folder = await renameFolder(id, name);
  if (!folder) return NextResponse.json({ error: "폴더를 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json(folder);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ok = await deleteFolder(id);
  if (!ok) return NextResponse.json({ error: "폴더를 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
