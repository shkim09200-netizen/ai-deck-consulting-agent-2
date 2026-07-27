// Confirms the Gap Analysis stage runs and slides carry status + checklist.
const BASE = process.env.BASE ?? "http://localhost:3210";

// deliberately incomplete deck: strong problem, but NO market sizing, NO traction numbers
const company = `주식회사 노바셀 (NovaCell)
한 줄 소개: 폐배터리에서 리튬을 회수하는 건식 재활용 스타트업.
문제: 국내 폐배터리 재활용은 습식 위주라 폐수·비용 부담이 크고 회수율이 낮습니다. 재활용 업체들은 폐수 처리에 매년 큰 비용을 씁니다.
솔루션: 자체 건식 열분해 공정으로 폐수 없이 리튬을 회수합니다.
팀: 대표는 LG에너지솔루션 공정개발 8년.`;

async function main() {
  const fd = new FormData();
  fd.append("files", new Blob([company], { type: "text/plain" }), "novacell.txt");
  fd.append("directives", "발표 5분, 슬라이드 8장 내외.");
  const gen = await fetch(`${BASE}/api/generate`, { method: "POST", body: fd });
  const { jobId } = await gen.json();
  console.log("jobId", jobId, "\nstream …");

  const res = await fetch(`${BASE}/api/jobs/${jobId}/stream`);
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let result: any = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const chunks = buf.split("\n\n"); buf = chunks.pop() ?? "";
    for (const c of chunks) {
      const line = c.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const snap = JSON.parse(line.slice(5).trim());
      const active = snap.stages?.find((s: any) => s.status === "active");
      if (active) process.stdout.write(`  · ${active.label}\r`);
      if (snap.status === "done") { result = snap.result; reader.cancel().catch(() => {}); break; }
      if (snap.status === "error") throw new Error("gen error: " + snap.error);
    }
    if (result) break;
  }
  if (!result) throw new Error("no result");

  const gap = result.gap;
  console.log("\n\n=== GAP ANALYSIS ===");
  console.log("storyline:", (gap.storyline || "").slice(0, 160));
  console.log("missingSections:", JSON.stringify(gap.missingSections));
  console.log("orderIssues:", gap.orderIssues.length);
  console.log("sections analyzed:", gap.sections.length);
  const marketSec = gap.sections.find((s: any) => s.sectionKey === "market");
  if (marketSec) {
    console.log(`  market coverage: ${marketSec.coverage}`);
    console.log(`  market items:`, marketSec.items.map((i: any) => `${i.done ? "☑" : "☐"}${i.label}`).join(" "));
  }

  console.log("\n=== SLIDES (status · checklist) ===");
  for (const sl of result.skeleton.slides) {
    const miss = (sl.checklist || []).filter((c: any) => !c.done).length;
    console.log(`  #${sl.no} [${sl.status}] ${sl.sectionKey} — checklist ${sl.checklist?.length ?? 0} (부족 ${miss})  ${sl.gapNote ? "· rec✓" : ""}`);
  }

  const anyStatus = result.skeleton.slides.some((s: any) => s.status && s.status !== "ok");
  const anyChecklist = result.skeleton.slides.some((s: any) => (s.checklist?.length ?? 0) > 0);
  const gapOk = gap.sections.length > 0;
  console.log(`\ncheck — gap sections: ${gapOk} | any slide status≠ok: ${anyStatus} | any checklist: ${anyChecklist}`);
  console.log(gapOk && anyStatus && anyChecklist ? "✅ GAP E2E OK" : "❌ GAP E2E INCOMPLETE");
  if (!(gapOk && anyStatus && anyChecklist)) process.exit(1);
}
main().catch((e) => { console.error("FAILED:", e); process.exit(1); });
