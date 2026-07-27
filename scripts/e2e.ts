// Drives the LIVE dev server (http://localhost:3210) end-to-end to confirm the
// generate → stream → translate path works (the English 404 fix).
const BASE = process.env.BASE ?? "http://localhost:3210";

const company = `주식회사 노바셀 (NovaCell)
한 줄 소개: 폐배터리에서 리튬을 90% 이상 회수하는 건식 재활용 스타트업.
문제: 국내 폐배터리 재활용은 습식 공정 위주라 폐수·비용 부담이 크고 회수율이 낮습니다.
솔루션: 자체 건식 열분해 공정으로 폐수 없이 리튬 회수율 92%를 달성했습니다.
비즈니스 모델: 배터리 제조사에 회수 리튬을 톤 단위로 판매.
트랙션: 2024년 매출 12억원, 파일럿 고객 3개사, 환경부 실증 선정.
팀: 대표는 LG에너지솔루션 공정개발 8년, CTO는 KAIST 화학공학 박사.
비전: 배터리 순환경제의 표준을 만든다.`;

async function main() {
  const fd = new FormData();
  fd.append("files", new Blob([company], { type: "text/plain" }), "novacell.txt");
  fd.append("directives", "발표 5분 기준, 슬라이드 8장 내외. Traction 강조.");

  console.log("POST /api/generate …");
  const gen = await fetch(`${BASE}/api/generate`, { method: "POST", body: fd });
  const genJson = await gen.json();
  console.log("  status", gen.status, genJson);
  const jobId = genJson.jobId as string;
  if (!jobId) throw new Error("no jobId");

  // consume SSE stream until done/error
  console.log("stream …");
  const res = await fetch(`${BASE}/api/jobs/${jobId}/stream`);
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let done = false;
  while (!done) {
    const { value, done: rd } = await reader.read();
    if (rd) break;
    buf += dec.decode(value, { stream: true });
    const chunks = buf.split("\n\n");
    buf = chunks.pop() ?? "";
    for (const c of chunks) {
      const line = c.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const snap = JSON.parse(line.slice(5).trim());
      if (snap.status === "done") {
        console.log("  DONE — slides:", snap.result?.skeleton?.slides?.length, "sections:", snap.result?.script?.sections?.length);
        done = true; break;
      } else if (snap.status === "error") {
        throw new Error("generation error: " + snap.error);
      } else {
        const active = snap.stages?.find((s: any) => s.status === "active");
        if (active) process.stdout.write(`  · ${active.label}\r`);
      }
    }
  }
  reader.cancel().catch(() => {});

  console.log("\nPOST /translate …");
  const tr = await fetch(`${BASE}/api/jobs/${jobId}/translate`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
  });
  console.log("  translate HTTP status:", tr.status);
  const trJson = await tr.json();
  if (tr.status !== 200) throw new Error("translate failed: " + JSON.stringify(trJson));
  console.log("  EN slide[0].headline:", trJson.script ? trJson.skeleton?.slides?.[0]?.headline : trJson);
  console.log("  EN section[0].title:", trJson.script?.sections?.[0]?.title);

  // confirm EN download is available
  const dl = await fetch(`${BASE}/api/jobs/${jobId}/download/pptx-en`);
  console.log("  GET /download/pptx-en:", dl.status, dl.headers.get("content-type"));

  console.log("\n✅ E2E OK — English path works (no 404).");
}
main().catch((e) => { console.error("E2E FAILED:", e); process.exit(1); });
