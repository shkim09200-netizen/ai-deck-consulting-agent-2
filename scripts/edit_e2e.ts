// Confirms a single AI-edit instruction updates BOTH the script AND the skeleton.
const BASE = process.env.BASE ?? "http://localhost:3210";

const company = `주식회사 노바셀 (NovaCell)
한 줄 소개: 폐배터리에서 리튬을 회수하는 건식 재활용 스타트업.
문제: 국내 폐배터리 재활용은 습식 위주라 폐수·비용 부담이 크고 회수율이 낮습니다.
솔루션: 자체 건식 열분해 공정으로 리튬 회수율 92%를 달성했습니다.
비즈니스 모델: 배터리 제조사에 회수 리튬을 톤 단위로 판매.
트랙션: 2024년 매출 12억원, 파일럿 고객 3개사.
팀: 대표는 LG에너지솔루션 공정개발 8년.
비전: 배터리 순환경제의 표준을 만든다.`;

async function genStream(): Promise<{ jobId: string; script: any; skeleton: any }> {
  const fd = new FormData();
  fd.append("files", new Blob([company], { type: "text/plain" }), "novacell.txt");
  fd.append("directives", "발표 5분, 슬라이드 8장 내외. 회수율 92%를 솔루션/지표에 강조.");
  const gen = await fetch(`${BASE}/api/generate`, { method: "POST", body: fd });
  const { jobId } = await gen.json();
  const res = await fetch(`${BASE}/api/jobs/${jobId}/stream`);
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const chunks = buf.split("\n\n"); buf = chunks.pop() ?? "";
    for (const c of chunks) {
      const line = c.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const snap = JSON.parse(line.slice(5).trim());
      if (snap.status === "done") { reader.cancel().catch(() => {}); return { jobId, script: snap.result.script, skeleton: snap.result.skeleton }; }
      if (snap.status === "error") throw new Error("gen error: " + snap.error);
    }
  }
  throw new Error("stream ended without done");
}

async function main() {
  console.log("generate …");
  const { jobId, script, skeleton } = await genStream();
  console.log("  jobId", jobId, "| sections", script.sections.length, "| slides", skeleton.slides.length);
  const before = { script: JSON.stringify(script).includes("92"), skeleton: JSON.stringify(skeleton).includes("92") };
  console.log("  '92' present before — script:", before.script, "skeleton:", before.skeleton);

  const instruction = "리튬 회수율을 92%에서 95%로 바꿔줘.";
  console.log(`\nedit: "${instruction}" …`);
  const res = await fetch(`${BASE}/api/jobs/${jobId}/edit`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instruction, script, skeleton }),
  });
  console.log("  edit HTTP:", res.status);
  const j = await res.json();
  if (res.status !== 200) throw new Error("edit failed: " + JSON.stringify(j));

  const sHas95 = JSON.stringify(j.script).includes("95");
  const kHas95 = JSON.stringify(j.skeleton).includes("95");
  const sHas92 = JSON.stringify(j.script).includes("92");
  const kHas92 = JSON.stringify(j.skeleton).includes("92");
  console.log("  summary:", j.summary);
  console.log("  changedScriptSections:", JSON.stringify(j.changedScriptSections), "changedSlides:", JSON.stringify(j.changedSlides));
  console.log("  AFTER — script has 95:", sHas95, "| skeleton has 95:", kHas95);
  console.log("  AFTER — script still has 92:", sHas92, "| skeleton still has 92:", kHas92);
  console.log("  accentColor preserved:", skeleton.accentColor, "->", j.skeleton.accentColor);

  const ok = sHas95 && kHas95 && (j.changedScriptSections?.length > 0) && (j.changedSlides?.length > 0);
  console.log(ok ? "\n✅ EDIT SYNC OK — 스크립트·슬라이드 둘 다 반영" : "\n❌ EDIT SYNC FAIL — 한쪽만 반영됨");
  if (!ok) process.exit(1);
}
main().catch((e) => { console.error("FAILED:", e); process.exit(1); });
