"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import SlideCanvas, { SlideChecklist } from "./slide/SlideCanvas";
import VariantPicker from "./slide/VariantPicker";
import GapReport from "./GapReport";
import { sectionTitleOf } from "./slide/sections";
import { brandMark } from "@engine/domain/deckTheme.js";
import type { JobResult, ScriptDoc, SkeletonDoc } from "./types";

interface Stage { key: string; label: string; status: "pending" | "active" | "done" | "error"; detail?: string; }
interface Snapshot {
  id: string; status: "running" | "done" | "error"; progress: number;
  stages: Stage[]; sourceNames: string[]; error?: string; result?: JobResult;
}

type Phase = "idle" | "running" | "done" | "error";
type Tab = "gap" | "skeleton" | "script" | "tracker" | "review";

// Mirrors the server pipeline stages. Generation runs synchronously (no live
// stream on serverless), so we show these locally with an eased progress bar.
const STAGE_LABELS = [
  "자료 파싱",
  "회사 정보 추출 (Ingestion)",
  "Gap 분석 (SparkLabs 기준 진단)",
  "명확화 질문 확인",
  "Step 1 — Script 생성",
  "Step 2 — Skeleton 생성",
  "AI Review + 통합 트래커",
];

function ConfirmText({ text }: { text: string }) {
  const parts = text.split(/(\[CONFIRM:[^\]]*\])/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("[CONFIRM:") ? <span key={i} className="confirm-inline">{p}</span> : <span key={i}>{p}</span>,
      )}
    </>
  );
}

interface Props {
  projectId: string;
  onOpenEditor: (jobId: string, result: JobResult) => void;
}

export default function InputScreen({ projectId, onOpenEditor }: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [directives, setDirectives] = useState("");
  const [urls, setUrls] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [err, setErr] = useState<string | undefined>();
  const [tab, setTab] = useState<Tab>("gap");
  const [drag, setDrag] = useState(false);
  const [lang, setLang] = useState<"ko" | "en">("ko");
  const [enData, setEnData] = useState<{ script: ScriptDoc; skeleton: SkeletonDoc } | null>(null);
  const [translating, setTranslating] = useState(false);
  const [transErr, setTransErr] = useState<string | undefined>();
  const [restoring, setRestoring] = useState(true);
  const [variant, setVariant] = useState<string>("minimal");
  const inputRef = useRef<HTMLInputElement>(null);

  // On open, restore this project's most recent generation (if any) so the
  // previously generated deck shows instead of a blank form.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setRestoring(true);
      try {
        const p = await fetch(`/api/projects/${projectId}`).then((r) => (r.ok ? r.json() : null));
        if (!p?.latest_job_id) return;
        const s = await fetch(`/api/jobs/${p.latest_job_id}`).then((r) => (r.ok ? r.json() : null));
        if (cancelled || !s?.result) return;
        setSnap(s);
        setJobId(p.latest_job_id);
        setPhase("done");
        setTab("gap");
      } catch {
        /* no saved deck — start fresh */
      } finally {
        if (!cancelled) setRestoring(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const addFiles = useCallback((list: FileList | null) => {
    if (!list) return;
    setFiles((prev) => {
      const names = new Set(prev.map((f) => f.name + f.size));
      const next = [...prev];
      for (const f of Array.from(list)) if (!names.has(f.name + f.size)) next.push(f);
      return next;
    });
  }, []);

  const hasUrls = urls.split(/[\s,]+/).some((u) => /^https?:\/\//i.test(u.trim()));

  async function switchLang(next: "ko" | "en") {
    setTransErr(undefined);
    if (next === "ko" || enData) { setLang(next); return; }
    if (!result || !jobId) return;
    setTranslating(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}/translate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script: result.script, skeleton: result.skeleton }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setTransErr(j.error || "영어 번역에 실패했습니다."); return; }
      setEnData({ script: j.script, skeleton: j.skeleton });
      setLang("en");
    } catch (e) {
      setTransErr(String(e));
    } finally {
      setTranslating(false);
    }
  }

  async function generate() {
    if (files.length === 0 && !hasUrls) return;
    setPhase("running"); setErr(undefined); setJobId(null);
    setLang("ko"); setEnData(null); setTransErr(undefined);
    // Local placeholder progress: generation is synchronous server-side, so the
    // real snapshot only arrives when it's finished. Show the stages meanwhile.
    const urlNames = urls.split(/[\s,]+/).map((u) => u.trim()).filter((u) => /^https?:\/\//i.test(u));
    setSnap({
      id: "", status: "running", progress: 4,
      stages: STAGE_LABELS.map((label, i) => ({ key: String(i), label, status: "active" })),
      sourceNames: [...files.map((f) => f.name), ...urlNames],
    });
    try {
      // Large files (>4MB) are uploaded straight to object storage (R2) via a
      // presigned URL so they bypass the serverless 4.5MB request-body limit;
      // only the storage key is sent to the API. Small files ride along inline.
      const fd = new FormData();
      const uploadRefs: Array<{ name: string; key: string; url?: string }> = [];
      const BIG = 4 * 1024 * 1024;
      for (const f of files) {
        if (f.size >= BIG) {
          try {
            const ct = f.type || "application/octet-stream";
            const info = await fetch("/api/upload-url", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ filename: f.name, contentType: ct }),
            }).then((r) => r.json());
            if (info.provider === "r2" && info.url) {
              const put = await fetch(info.url, { method: "PUT", body: f, headers: { "Content-Type": ct } });
              if (!put.ok) throw new Error("upload failed");
              uploadRefs.push({ name: f.name, key: info.key });
            } else if (info.provider === "blob") {
              const res = await upload(info.key, f, { access: "public", handleUploadUrl: "/api/blob/upload" });
              uploadRefs.push({ name: f.name, key: info.key, url: res.url });
            } else {
              fd.append("files", f); // no object storage configured → send inline
            }
          } catch {
            fd.append("files", f); // fallback: send inline (may exceed the limit)
          }
        } else {
          fd.append("files", f);
        }
      }
      if (uploadRefs.length) fd.append("uploadRefs", JSON.stringify(uploadRefs));
      fd.append("projectId", projectId);
      if (directives.trim()) fd.append("directives", directives.trim());
      if (urls.trim()) fd.append("urls", urls.trim());
      // Step 1: parse + ingest (one short request)
      const res = await fetch("/api/generate", { method: "POST", body: fd });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error || "생성을 시작하지 못했습니다."); setPhase("error"); return;
      }
      let s: Snapshot = await res.json();
      setSnap(s); setJobId(s.id);
      // Steps 2..N: drive the staged pipeline, one bounded request per step, so
      // no single call exceeds the serverless time limit.
      let guard = 0;
      while (s.status === "running" && guard++ < 12) {
        // carry the job state in the body so a step landing on a fresh server
        // (or a not-yet-consistent storage read) never yields "job not found".
        const r = await fetch(`/api/jobs/${s.id}/advance`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ job: s }),
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          setErr(j.error || "생성 중 오류가 발생했습니다."); setPhase("error"); return;
        }
        s = await r.json();
        setSnap(s);
      }
      if (s.status === "error") { setErr(s.error || "생성 중 오류가 발생했습니다."); setPhase("error"); return; }
      if (s.status !== "done") { setErr("생성이 완료되지 않았습니다. 다시 시도해 주세요."); setPhase("error"); return; }
      setPhase("done"); setTab("gap");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "네트워크 오류가 발생했습니다."); setPhase("error");
    }
  }

  // Ease the placeholder progress bar toward ~92% while the request is in flight.
  useEffect(() => {
    if (phase !== "running") return;
    const t = setInterval(() => {
      setSnap((s) =>
        s && s.status === "running"
          ? { ...s, progress: Math.min(92, Math.round(s.progress + Math.max(1, (92 - s.progress) * 0.06))) }
          : s,
      );
    }, 800);
    return () => clearInterval(t);
  }, [phase]);

  function resetAll() {
    setFiles([]); setDirectives(""); setUrls("");
    setPhase("idle"); setSnap(null); setJobId(null); setErr(undefined);
    setTab("gap");
    setLang("ko"); setEnData(null); setTransErr(undefined);
    if (inputRef.current) inputRef.current.value = "";
  }

  const result = snap?.result;
  const busy = phase === "running";

  return (
    <div className="wrap">
      <div className="grid">
        {/* -------- left: input + progress -------- */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="card">
            <div className="card-head">
              <h2>1 · 자료 업로드</h2>
              {phase !== "idle" && (
                <button className="ghost xs" onClick={resetAll} disabled={busy} title="폼을 비우고 새로 생성합니다">＋ 새로 만들기</button>
              )}
            </div>
            <div
              className={`dropzone${drag ? " drag" : ""}`}
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}
            >
              <div className="big">파일을 끌어다 놓거나 클릭</div>
              <small>IR Deck · 이전 덱(PPTX) · 원페이저 · IR 자료 · 이미지 — 그냥 다 넣으세요 (PDF, DOCX, PPTX, XLSX, 이미지, TXT)</small>
              <input
                ref={inputRef} type="file" multiple hidden
                onChange={(e) => addFiles(e.target.files)}
                accept=".pdf,.docx,.pptx,.xlsx,.xls,.csv,.png,.jpg,.jpeg,.txt,.md"
              />
            </div>
            {files.length > 0 && (
              <ul className="filelist">
                {files.map((f, i) => (
                  <li key={f.name + i}>
                    <span>📄 {f.name}</span>
                    <button className="rm" title="제거" onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}>×</button>
                  </li>
                ))}
              </ul>
            )}

            <label className="field-label">웹사이트 링크 <span className="muted">(선택 · 한 줄에 하나 또는 쉼표로)</span></label>
            <textarea
              className="tx"
              rows={2}
              placeholder="https://example.com  회사 홈페이지·서비스 링크"
              value={urls}
              onChange={(e) => setUrls(e.target.value)}
            />

            <label className="field-label">세부 지시사항 <span className="muted">(선택 · 발표 시간·슬라이드 수·강조점·톤 등)</span></label>
            <textarea
              className="tx"
              rows={3}
              placeholder={"예) 발표 7분 기준, 슬라이드 12장 내외.\nTraction을 앞쪽에 강조. 투자자에게 시장 규모를 크게 보여줘.\n톤은 신뢰감 있게."}
              value={directives}
              onChange={(e) => setDirectives(e.target.value)}
            />

            <button className="primary" disabled={(files.length === 0 && !hasUrls) || busy} onClick={generate}>
              {busy ? "생성 중…" : "Generate — Script & 슬라이드"}
            </button>
            <p className="hint">전체 파이프라인(자료 분석 → 대본 → 슬라이드 설계 → 리뷰)이 한 번에 실행됩니다. 약 1~2분 소요.</p>
            {err && <div className="error-box">⚠ {err}</div>}
          </div>

          {(phase === "running" || phase === "done") && snap && (
            <div className="card">
              <h2>2 · 진행 상황</h2>
              <div className="bar"><div style={{ width: `${snap.progress}%` }} /></div>
              <ul className="stages">
                {snap.stages.map((s) => (
                  <li key={s.key} className={`stage ${s.status}`}>
                    <span className="dot">{s.status === "done" ? "✓" : s.status === "error" ? "!" : ""}</span>
                    <span className="label">{s.label}</span>
                    {s.detail && <span className="detail">{s.detail}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* -------- right: results -------- */}
        <div className="card" style={{ minHeight: 360 }}>
          {!result && (
            <div className="empty">
              {restoring
                ? "이전 생성 결과를 불러오는 중…"
                : phase === "running"
                  ? "생성 중입니다. 왼쪽에서 진행 상황을 확인하세요…"
                  : "결과가 여기에 표시됩니다. 자료를 업로드하고 Generate를 눌러주세요."}
            </div>
          )}

          {result && jobId && (() => {
            const en = lang === "en" && enData;
            const activeScript = en ? enData!.script : result.script;
            const activeSkeleton = en ? enData!.skeleton : result.skeleton;
            const dlSuffix = en ? "-en" : "";
            return (
            <>
              <div className="summary">
                <span className="name">{result.companyName}</span>
                <span className="pill">발표 {result.presentationMinutes}분</span>
                <span className="pill">{activeScript.sections.length} 섹션</span>
                <span className="pill">{activeSkeleton.slides.length} 슬라이드</span>
              </div>

              <div className="langbar">
                <div className="langtoggle">
                  <button className={lang === "ko" ? "on" : ""} onClick={() => switchLang("ko")} disabled={translating}>한국어</button>
                  <button className={lang === "en" ? "on" : ""} onClick={() => switchLang("en")} disabled={translating}>
                    {translating ? "번역 중…" : "English"}
                  </button>
                </div>
                {transErr && <span className="langerr">⚠ {transErr}</span>}
                {en && <span className="langhint">영어본은 현재 생성 결과 기준입니다. 편집 후 최신 영어본은 편집화면에서.</span>}
              </div>

              <div className="downloads">
                <a className="dl" href={`/api/jobs/${jobId}/download/docx${dlSuffix}`}>
                  <span className="ico">📝</span> Script (.docx){en ? " · EN" : ""}
                </a>
                <a className="dl" href={`/api/jobs/${jobId}/download/pptx${dlSuffix}?variant=${variant}`}>
                  <span className="ico">📊</span> Slides (.pptx){en ? " · EN" : ""} · {variant}
                </a>
              </div>

              <button className="primary" style={{ marginTop: 14 }} onClick={() => onOpenEditor(jobId, result)}>
                ✏️ 편집기 — 편집 &amp; 실시간 미리보기 열기
              </button>

              <div className="tabs">
                <div className={`tab${tab === "gap" ? " on" : ""}`} onClick={() => setTab("gap")}>
                  Gap 분석 <span className="n">({result.gap.missingSections.length + result.gap.orderIssues.length}건)</span>
                </div>
                <div className={`tab${tab === "skeleton" ? " on" : ""}`} onClick={() => setTab("skeleton")}>
                  슬라이드 <span className="n">({activeSkeleton.slides.length})</span>
                </div>
                <div className={`tab${tab === "script" ? " on" : ""}`} onClick={() => setTab("script")}>
                  Script
                </div>
                <div className={`tab${tab === "tracker" ? " on" : ""}`} onClick={() => setTab("tracker")}>
                  미해결 <span className="n">({result.tracker.length})</span>
                </div>
                <div className={`tab${tab === "review" ? " on" : ""}`} onClick={() => setTab("review")}>
                  AI Review <span className="n">({result.review.length})</span>
                </div>
              </div>

              {tab === "gap" && <GapReport gap={result.gap} />}

              {tab === "skeleton" && (
                <div className="deck-preview">
                  <VariantPicker skeleton={activeSkeleton} value={variant} onChange={setVariant} />
                  {activeSkeleton.slides.map((sl, i) => (
                    <div className="slide-card" key={sl.no}>
                      <SlideCanvas
                        slide={sl}
                        accentColor={activeSkeleton.accentColor}
                        variant={variant}
                        pageNo={i + 1}
                        total={activeSkeleton.slides.length}
                        sectionTitle={sectionTitleOf(sl.sectionKey)}
                        brand={brandMark(activeSkeleton.companyName)}
                      />
                      <SlideChecklist slide={sl} />
                      {sl.flags.length > 0 && (
                        <div className="flags">
                          {sl.flags.map((f, j) => <span className="fl" key={j}>⚠ {f.message}</span>)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {tab === "script" && (
                <div>
                  {activeScript.sections.map((s) => (
                    <div className="section" key={s.no}>
                      <div className="stitle"><span className="no">§{s.no}</span>({s.title})</div>
                      {s.beats.map((b, i) => (
                        <div className="beat" key={i}>
                          <ConfirmText text={b.text} />
                          {b.click && <span className="click"> (click)</span>}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}

              {tab === "tracker" && (
                <>
                  {result.clarifications.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                      <h3>확인이 필요한 질문 (환각 방지 게이트)</h3>
                      <ol className="clarify">
                        {result.clarifications.map((q, i) => <li key={i}>{q}</li>)}
                      </ol>
                    </div>
                  )}
                  <h3>통합 미해결 항목</h3>
                  {result.tracker.length === 0 ? (
                    <div className="empty">✅ 미해결 항목 없음</div>
                  ) : (
                    <ul className="tracker">
                      {result.tracker.map((it) => (
                        <li key={it.index}>
                          <span className={`tag ${it.kind === "CONFIRM" ? "confirm" : "needs"}`}>
                            {it.kind === "CONFIRM" ? "확인필요" : "자료필요"}
                          </span>
                          <div>
                            <div>{it.message}</div>
                            <div className="loc">{it.locationRef}</div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}

              {tab === "review" && (
                result.review.length === 0 ? (
                  <div className="empty">✅ 리뷰 지적사항 없음</div>
                ) : (
                  <ul className="rev">
                    {result.review.map((r, i) => (
                      <li key={i}>
                        <span className={`sev ${r.severity}`}>{r.severity}</span>
                        <div>
                          <div className="cat">{r.category} · {r.locationRef}</div>
                          <div>{r.message}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )
              )}
            </>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
