import { NextRequest, NextResponse } from "next/server";
import { listFolders, createFolder } from "@/lib/store";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await listFolders());
}

export async function POST(req: NextRequest) {
  let body: { name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 본문입니다." }, { status: 400 });
  }
  const name = (body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "폴더 이름을 입력하세요." }, { status: 400 });
  const folder = await createFolder(name);
  return NextResponse.json(folder);
}
