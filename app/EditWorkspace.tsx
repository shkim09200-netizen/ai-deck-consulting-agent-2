"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import SlideCanvas, { SlideChecklist } from "./slide/SlideCanvas";
import VariantPicker from "./slide/VariantPicker";
import GapReport from "./GapReport";
import { sectionTitleOf } from "./slide/sections";
import { brandMark } from "@engine/domain/deckTheme.js";
import type {
  ChartSpec,
  ChatMsg,
  DeckVersion,
  JobResult,
  ScriptDoc,
  Slide,
  SkeletonDoc,
  TrackerItem,
} from "./types";

interface Props {
  jobId: string;
  result: JobResult;
  onBack: () => void;
  /** Chat histories are owned by the shell so tab switches don't reset them. */
  chat: ChatMsg[];
  setChat: React.Dispatch<React.SetStateAction<ChatMsg[]>>;
  askChat: ChatMsg[];
  setAskChat: React.Dispatch<React.SetStateAction<ChatMsg[]>>;
}

const clone = <T,>(v: T): T =>
  typeof structuredClone === "function" ? structuredClone(v) : JSON.parse(JSON.stringify(v));

const CONFIRM_RE = /\[CONFIRM:\s*([^\]]+)\]/g;
const NEEDS_RE = /\[NEEDS INPUT:\s*([^\]]*)\]/g;

const LAYOUTS: Slide["layout"][] = ["cover", "statement", "bullets", "metrics", "comparison", "process", "chart", "team", "closing"];

function emptySlide(no: number): Slide {
  return {
    no, sectionKey: "custom", layout: "bullets", eyebrow: "", headline: "새 슬라이드", subhead: "",
    bullets: [], metrics: [], columns: [], steps: [], team: [], chart: null,
    visual: { kind: "none", direction: "" }, memo: "", speakerNotes: "", scriptRefs: [], flags: [],
    status: "ok", checklist: [],
  };
}

/** Live client-side tracker mirroring the engine's buildTracker(). */
function computeTracker(script: ScriptDoc, skeleton: SkeletonDoc): TrackerItem[] {
  const items: TrackerItem[] = [];
  const seen = new Set<string>();
  const push = (kind: TrackerItem["kind"], locationRef: string, message: string) => {
    const k = `${kind}|${locationRef}|${message}`;
    if (seen.has(k)) return;
    seen.add(k);
    items.push({ index: items.length + 1, kind, locationRef, message });
  };
  for (const s of script.sections) {
    for (const b of s.beats) {
      for (const m of b.text.matchAll(CONFIRM_RE)) push("CONFIRM", `Script §${s.no} (${s.title})`, m[1]!.trim());
    }
  }
  for (const sl of skeleton.slides) {
    for (const f of sl.flags) push(f.kind, f.locationRef, f.message);
    for (const m of `${sl.memo} ${sl.visual?.direction ?? ""}`.matchAll(NEEDS_RE))
      push("NEEDS_INPUT", `Slide ${sl.no}`, (m[1] ?? "").trim() || `Slide ${sl.no}`);
    if (sl.chart && !sl.chart.confirmed)
      push("NEEDS_INPUT", `Slide ${sl.no}`, `차트 수치 미확인: ${sl.chart.title || sl.headline || "차트"}`);
  }
  return items;
}

function refToSectionNo(ref: string): number | null {
  const m = ref.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

/* ============================ Slide inspector ============================ */
function SlideInspector({ slide, patch }: { slide: Slide; patch: (mut: (s: Slide) => void) => void }) {
  const L = slide.layout;
  const showBullets = ["bullets", "statement", "chart", "closing", "metrics"].includes(L) || slide.bullets.length > 0;
  const showMetrics = L === "metrics" || slide.metrics.length > 0;
  const showColumns = L === "comparison" || slide.columns.length > 0;
  const showSteps = L === "process" || slide.steps.length > 0;
  const showTeam = L === "team" || slide.team.length > 0;
  const showChart = ["chart", "metrics"].includes(L) || !!slide.chart;

  return (
    <div className="inspector">
      <div className="insp-row">
        <div className="insp-field">
          <label className="fk">레이아웃</label>
          <select className="tin" value={L} onChange={(e) => patch((s) => { s.layout = e.target.value as Slide["layout"]; })}>
            {LAYOUTS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <div className="insp-field">
          <label className="fk">Eyebrow (섹션 라벨)</label>
          <input className="tin" value={slide.eyebrow} onChange={(e) => patch((s) => { s.eyebrow = e.target.value; })} />
        </div>
      </div>

      <label className="fk">헤드라인</label>
      <input className="tin" value={slide.headline} onChange={(e) => patch((s) => { s.headline = e.target.value; })} />

      <label className="fk">서브헤드</label>
      <input className="tin" value={slide.subhead} onChange={(e) => patch((s) => { s.subhead = e.target.value; })} />

      {showBullets && (
        <div className="insp-group">
          <label className="fk">핵심 문구</label>
          {slide.bullets.map((b, bi) => (
            <div key={bi} className="ost-row">
              <input className="tin" value={b.text} onChange={(e) => patch((s) => { s.bullets[bi]!.text = e.target.value; })} />
              <label className="clk"><input type="checkbox" checked={b.emphasis} onChange={() => patch((s) => { s.bullets[bi]!.emphasis = !s.bullets[bi]!.emphasis; })} />강조</label>
              <button className="ghost xs" onClick={() => patch((s) => { s.bullets.splice(bi, 1); })}>×</button>
            </div>
          ))}
          <button className="ghost xs add" onClick={() => patch((s) => { s.bullets.push({ text: "", emphasis: false }); })}>+ 문구</button>
        </div>
      )}

      {showMetrics && (
        <div className="insp-group">
          <label className="fk">지표 카드</label>
          {slide.metrics.map((m, mi) => (
            <div key={mi} className="ost-row wrap">
              <input className="tin sm" placeholder="값 (3초)" value={m.value} onChange={(e) => patch((s) => { s.metrics[mi]!.value = e.target.value; })} />
              <input className="tin" placeholder="라벨" value={m.label} onChange={(e) => patch((s) => { s.metrics[mi]!.label = e.target.value; })} />
              <input className="tin sm" placeholder="부가(선택)" value={m.sub ?? ""} onChange={(e) => patch((s) => { s.metrics[mi]!.sub = e.target.value; })} />
              <button className="ghost xs" onClick={() => patch((s) => { s.metrics.splice(mi, 1); })}>×</button>
            </div>
          ))}
          <button className="ghost xs add" onClick={() => patch((s) => { s.metrics.push({ value: "", label: "" }); })}>+ 지표</button>
        </div>
      )}

      {showColumns && (
        <div className="insp-group">
          <label className="fk">비교 열</label>
          {slide.columns.map((c, ci) => (
            <div key={ci} className="col-edit">
              <div className="ost-row">
                <input className="tin" placeholder="열 제목" value={c.heading} onChange={(e) => patch((s) => { s.columns[ci]!.heading = e.target.value; })} />
                <label className="clk"><input type="checkbox" checked={!!c.accent} onChange={() => patch((s) => { s.columns[ci]!.accent = !s.columns[ci]!.accent; })} />강조</label>
                <button className="ghost xs" onClick={() => patch((s) => { s.columns.splice(ci, 1); })}>×</button>
              </div>
              <textarea className="tx" rows={2} placeholder="항목 (줄바꿈으로 구분)" value={c.items.join("\n")}
                onChange={(e) => patch((s) => { s.columns[ci]!.items = e.target.value.split("\n"); })} />
            </div>
          ))}
          <button className="ghost xs add" onClick={() => patch((s) => { s.columns.push({ heading: "", items: [] }); })}>+ 열</button>
        </div>
      )}

      {showSteps && (
        <div className="insp-group">
          <label className="fk">단계</label>
          {slide.steps.map((st, si) => (
            <div key={si} className="ost-row wrap">
              <input className="tin sm" placeholder="제목" value={st.title} onChange={(e) => patch((s) => { s.steps[si]!.title = e.target.value; })} />
              <input className="tin" placeholder="설명(선택)" value={st.detail ?? ""} onChange={(e) => patch((s) => { s.steps[si]!.detail = e.target.value; })} />
              <button className="ghost xs" onClick={() => patch((s) => { s.steps.splice(si, 1); })}>×</button>
            </div>
          ))}
          <button className="ghost xs add" onClick={() => patch((s) => { s.steps.push({ title: "" }); })}>+ 단계</button>
        </div>
      )}

      {showTeam && (
        <div className="insp-group">
          <label className="fk">팀</label>
          {slide.team.map((t, ti) => (
            <div key={ti} className="ost-row wrap">
              <input className="tin sm" placeholder="이름" value={t.name} onChange={(e) => patch((s) => { s.team[ti]!.name = e.target.value; })} />
              <input className="tin sm" placeholder="역할" value={t.role ?? ""} onChange={(e) => patch((s) => { s.team[ti]!.role = e.target.value; })} />
              <input className="tin" placeholder="경력/자격" value={t.note ?? ""} onChange={(e) => patch((s) => { s.team[ti]!.note = e.target.value; })} />
              <label className="clk"><input type="checkbox" checked={t.fullTime !== false} onChange={() => patch((s) => { s.team[ti]!.fullTime = t.fullTime === false ? true : false; })} />풀타임</label>
              <button className="ghost xs" onClick={() => patch((s) => { s.team.splice(ti, 1); })}>×</button>
            </div>
          ))}
          <button className="ghost xs add" onClick={() => patch((s) => { s.team.push({ name: "", fullTime: true }); })}>+ 팀원</button>
        </div>
      )}

      {showChart && (
        <div className="insp-group">
          <label className="fk">차트</label>
          {slide.chart ? (
            <ChartEditor chart={slide.chart} patch={patch} />
          ) : (
            <button className="ghost xs add" onClick={() => patch((s) => { s.chart = { type: "bar", categories: [], series: [{ name: "값", values: [] }], confirmed: false }; })}>+ 차트 추가</button>
          )}
        </div>
      )}

      <div className="insp-group">
        <label className="fk">비주얼 (이미지 지시)</label>
        <div className="ost-row wrap">
          <select className="tin sm" value={slide.visual.kind} onChange={(e) => patch((s) => { s.visual.kind = e.target.value as Slide["visual"]["kind"]; })}>
            {(["none", "image", "screenshot", "diagram", "logo"] as const).map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <label className="clk"><input type="checkbox" checked={!!slide.visual.needsAsset} onChange={() => patch((s) => { s.visual.needsAsset = !s.visual.needsAsset; })} />실제 자료 필요</label>
        </div>
        <textarea className="tx" rows={2} value={slide.visual.direction} onChange={(e) => patch((s) => { s.visual.direction = e.target.value; })} />
      </div>

      <label className="fk">메모 (디자인/연출 · [NEEDS INPUT])</label>
      <textarea className={`tx${/\[NEEDS INPUT/.test(slide.memo) ? " has-flag" : ""}`} rows={2} value={slide.memo} onChange={(e) => patch((s) => { s.memo = e.target.value; })} />

      <label className="fk">발표자 노트 (대본 매핑)</label>
      <textarea className="tx" rows={3} value={slide.speakerNotes} onChange={(e) => patch((s) => { s.speakerNotes = e.target.value; })} />
    </div>
  );
}

function ChartEditor({ chart, patch }: { chart: ChartSpec; patch: (mut: (s: Slide) => void) => void }) {
  const num = (csv: string) => csv.split(",").map((x) => Number(x.trim())).filter((n) => !Number.isNaN(n));
  return (
    <div className="chart-edit">
      <div className="ost-row wrap">
        <select className="tin sm" value={chart.type} onChange={(e) => patch((s) => { s.chart!.type = e.target.value as ChartSpec["type"]; })}>
          {(["bar", "line", "area", "pie"] as const).map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input className="tin" placeholder="차트 제목" value={chart.title ?? ""} onChange={(e) => patch((s) => { s.chart!.title = e.target.value; })} />
        <input className="tin sm" placeholder="단위" value={chart.unit ?? ""} onChange={(e) => patch((s) => { s.chart!.unit = e.target.value; })} />
        <label className="clk"><input type="checkbox" checked={chart.confirmed} onChange={() => patch((s) => { s.chart!.confirmed = !s.chart!.confirmed; })} />자료 근거</label>
      </div>
      <label className="fk sm">카테고리 (쉼표)</label>
      <input className="tin" value={chart.categories.join(", ")} onChange={(e) => patch((s) => { s.chart!.categories = e.target.value.split(",").map((x) => x.trim()).filter(Boolean); })} />
      {chart.series.map((se, i) => (
        <div key={i} className="ost-row wrap">
          <input className="tin sm" placeholder="계열명" value={se.name} onChange={(e) => patch((s) => { s.chart!.series[i]!.name = e.target.value; })} />
          <input className="tin" placeholder="값 (쉼표: 1, 2, 3)" value={se.values.join(", ")} onChange={(e) => patch((s) => { s.chart!.series[i]!.values = num(e.target.value); })} />
          <button className="ghost xs" onClick={() => patch((s) => { s.chart!.series.splice(i, 1); })}>×</button>
        </div>
      ))}
      <div className="ost-row">
        <button className="ghost xs add" onClick={() => patch((s) => { s.chart!.series.push({ name: "", values: [] }); })}>+ 계열</button>
        <button className="ghost xs" onClick={() => patch((s) => { s.chart = null; })}>차트 제거</button>
      </div>
    </div>
  );
}

/* ============================ Workspace ============================ */
export default function EditWorkspace({ jobId, result, onBack, chat, setChat, askChat, setAskChat }: Props) {
  const [script, setScript] = useState<ScriptDoc>(() => clone(result.script));
  const [skeleton, setSkeleton] = useState<SkeletonDoc>(() => clone(result.skeleton));
  const [versions, setVersions] = useState<DeckVersion[]>(() => [
    { label: "v0.1", ts: Date.now(), note: "최초 생성", script: clone(result.script), skeleton: clone(result.skeleton) },
  ]);
  const [dirty, setDirty] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [sending, setSending] = useState(false);
  const [askInput, setAskInput] = useState("");
  const [asking, setAsking] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [savedLabel, setSavedLabel] = useState<string | null>("v0.1");
  const [hlSection, setHlSection] = useState<number | null>(null);
  const [hlSlide, setHlSlide] = useState<number | null>(null);
  const [openSlide, setOpenSlide] = useState<number | null>(null);
  const [enOpen, setEnOpen] = useState(false);
  const [enData, setEnData] = useState<{ script: ScriptDoc; skeleton: SkeletonDoc } | null>(null);
  const [enBusy, setEnBusy] = useState(false);
  const [enErr, setEnErr] = useState<string | undefined>();
  const [enStamp, setEnStamp] = useState<string>("");

  const [variant, setVariant] = useState<string>(() => result.skeleton.variant ?? "minimal");

  const [splitPct, setSplitPct] = useState(50);
  const splitRef = useRef<HTMLDivElement>(null);

  const sectionRefs = useRef(new Map<number, HTMLDivElement | null>());
  const slideRefs = useRef(new Map<number, HTMLDivElement | null>());

  function startResize(e: React.MouseEvent) {
    e.preventDefault();
    const container = splitRef.current;
    if (!container) return;
    const onMove = (ev: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      setSplitPct(Math.min(80, Math.max(20, pct)));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.classList.remove("resizing");
    };
    document.body.classList.add("resizing");
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  const tracker = useMemo(() => computeTracker(script, skeleton), [script, skeleton]);

  const editScript = useCallback((mut: (s: ScriptDoc) => void) => {
    setScript((prev) => { const n = clone(prev); mut(n); return n; });
    setDirty(true);
  }, []);
  const editSkeleton = useCallback((mut: (s: SkeletonDoc) => void) => {
    setSkeleton((prev) => { const n = clone(prev); mut(n); return n; });
    setDirty(true);
  }, []);
  const patchSlide = useCallback((i: number, mut: (s: Slide) => void) => {
    editSkeleton((d) => { const sl = d.slides[i]; if (sl) mut(sl); });
  }, [editSkeleton]);

  const renumberSlides = (s: SkeletonDoc) => s.slides.forEach((sl, i) => (sl.no = i + 1));

  // pick a design variant: reflect it in the preview AND bake it into the
  // skeleton so a saved export / default download renders the chosen look.
  const chooseVariant = useCallback((id: string) => {
    setVariant(id);
    editSkeleton((d) => { d.variant = id; });
  }, [editSkeleton]);

  const flash = (setter: (n: number | null) => void, no: number) => {
    setter(no);
    window.setTimeout(() => setter(null), 1400);
  };
  const goSection = (no: number) => {
    sectionRefs.current.get(no)?.scrollIntoView({ behavior: "smooth", block: "center" });
    flash(setHlSection, no);
  };
  const goSlidesFor = (sectionNo: number) => {
    const target = skeleton.slides.find((sl) => sl.scriptRefs.some((r) => refToSectionNo(r) === sectionNo));
    if (target) {
      slideRefs.current.get(target.no)?.scrollIntoView({ behavior: "smooth", block: "center" });
      flash(setHlSlide, target.no);
    }
  };

  const pushVersion = (note: string): string => {
    const label = `v0.${versions.length + 1}`;
    setVersions((v) => [...v, { label, ts: Date.now(), note, script: clone(script), skeleton: clone(skeleton) }]);
    return label;
  };

  async function saveAndExport() {
    setExporting(true);
    const label = pushVersion(dirty ? "수동 편집 저장" : "저장");
    const version = label.replace(/^v/, "");
    try {
      const res = await fetch(`/api/jobs/${jobId}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script, skeleton, version }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setChat((c) => [...c, { role: "system", text: `Export 실패: ${j.error ?? res.status}` }]);
      } else {
        setSavedLabel(label);
        setDirty(false);
        setChat((c) => [...c, { role: "system", text: `${label} 저장 완료 — 아래 다운로드가 최신본으로 갱신됐습니다.` }]);
      }
    } catch (e) {
      setChat((c) => [...c, { role: "system", text: `Export 오류: ${String(e)}` }]);
    } finally {
      setExporting(false);
    }
  }

  function restore(v: DeckVersion) {
    setScript(clone(v.script));
    setSkeleton(clone(v.skeleton));
    setDirty(true);
    setChat((c) => [...c, { role: "system", text: `${v.label} 내용으로 되돌렸습니다. 저장하면 새 버전으로 반영됩니다.` }]);
  }

  async function openEnglish() {
    setEnBusy(true); setEnErr(undefined); setEnOpen(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}/translate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script, skeleton }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setEnErr(j.error || "영어 번역에 실패했습니다."); return; }
      setEnData({ script: j.script, skeleton: j.skeleton });
      setEnStamp(savedLabel ?? "현재 편집본");
    } catch (e) {
      setEnErr(String(e));
    } finally {
      setEnBusy(false);
    }
  }

  async function sendEdit() {
    const instruction = chatInput.trim();
    if (!instruction || sending) return;
    const history = chat
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role as "user" | "assistant", text: m.text }));
    setChat((c) => [...c, { role: "user", text: instruction }]);
    setChatInput("");
    setSending(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction, script, skeleton, history }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setChat((c) => [...c, { role: "assistant", text: `⚠ ${j.error ?? "AI 편집에 실패했습니다."}` }]);
      } else {
        setScript(j.script);
        setSkeleton(j.skeleton);
        setDirty(true);
        const changed: string[] = [];
        if (j.changedScriptSections?.length) changed.push(`Script §${j.changedScriptSections.join(", §")}`);
        if (j.changedSlides?.length) changed.push(`Slide ${j.changedSlides.join(", ")}`);
        setChat((c) => [
          ...c,
          { role: "assistant", text: j.summary + (changed.length ? `\n(변경: ${changed.join(" · ")})` : "") },
        ]);
        pushVersion(`AI: ${j.summary}`.slice(0, 60));
        const firstSlide = j.changedSlides?.[0];
        const firstSec = j.changedScriptSections?.[0];
        if (typeof firstSec === "number") setTimeout(() => goSection(firstSec), 60);
        else if (typeof firstSlide === "number") setTimeout(() => flash(setHlSlide, firstSlide), 60);
      }
    } catch (e) {
      setChat((c) => [...c, { role: "assistant", text: `⚠ 요청 오류: ${String(e)}` }]);
    } finally {
      setSending(false);
    }
  }

  async function sendAsk() {
    const question = askInput.trim();
    if (!question || asking) return;
    const history = askChat
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role as "user" | "assistant", text: m.text }));
    setAskChat((c) => [...c, { role: "user", text: question }]);
    setAskInput("");
    setAsking(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, script, skeleton, history }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAskChat((c) => [...c, { role: "assistant", text: `⚠ ${j.error ?? "답변에 실패했습니다."}` }]);
      } else {
        setAskChat((c) => [...c, { role: "assistant", text: j.answer }]);
      }
    } catch (e) {
      setAskChat((c) => [...c, { role: "assistant", text: `⚠ 요청 오류: ${String(e)}` }]);
    } finally {
      setAsking(false);
    }
  }

  const confirmCount = tracker.filter((t) => t.kind === "CONFIRM").length;
  const needsCount = tracker.filter((t) => t.kind === "NEEDS_INPUT").length;

  return (
    <div className="ew">
      <div className="ew-top">
        <button className="ghost" onClick={onBack}>← 생성 화면</button>
        <div className="ew-title">
          <strong>{script.companyName}</strong>
          <span className="pill">{savedLabel ?? "미저장"}{dirty ? " • 편집됨" : ""}</span>
          <span className="pill">미해결 {tracker.length} (확인 {confirmCount} / 자료 {needsCount})</span>
        </div>
        <div className="ew-actions">
          <a className="dl sm" href={`/api/jobs/${jobId}/download/docx`}>📝 .docx</a>
          <a className="dl sm" href={`/api/jobs/${jobId}/download/pptx?variant=${variant}`}>📊 .pptx · {variant}</a>
          <button className="ghost sm" disabled={enBusy} onClick={openEnglish} title="현재 편집본을 영어로 번역해 보기/내보내기">
            🌐 {enBusy ? "번역 중…" : "English"}
          </button>
          <button className="primary sm" disabled={exporting} onClick={saveAndExport}>
            {exporting ? "저장 중…" : "버전 저장 & 파일 반영"}
          </button>
        </div>
      </div>

      {enOpen && (
        <section className="card en-panel" style={{ marginBottom: 16 }}>
          <div className="en-head">
            <strong>🌐 English preview</strong>
            <span className="pill">{enStamp} 기준 번역</span>
            <div className="ew-actions" style={{ marginLeft: "auto" }}>
              <a className={`dl sm${enData ? "" : " disabled"}`} href={enData ? `/api/jobs/${jobId}/download/docx-en` : undefined}>📝 Script EN</a>
              <a className={`dl sm${enData ? "" : " disabled"}`} href={enData ? `/api/jobs/${jobId}/download/pptx-en?variant=${variant}` : undefined}>📊 Slides EN</a>
              <button className="ghost sm" onClick={openEnglish} disabled={enBusy}>↻ 최신본으로 재번역</button>
              <button className="ghost sm" onClick={() => setEnOpen(false)}>✕ 닫기</button>
            </div>
          </div>
          {enErr && <div className="error-box">⚠ {enErr}</div>}
          {enBusy && !enData && <div className="empty">현재 편집본을 영어로 번역 중입니다… (약 30초)</div>}
          {enData && (
            <div className="en-deck">
              <div className="en-col">
                {enData.skeleton.slides.map((sl, i) => (
                  <div className="en-slide" key={sl.no}>
                    <SlideCanvas slide={sl} accentColor={enData.skeleton.accentColor} variant={variant} pageNo={i + 1} total={enData.skeleton.slides.length} sectionTitle={sectionTitleOf(sl.sectionKey)} brand={brandMark(enData.skeleton.companyName)} />
                  </div>
                ))}
              </div>
              <div className="en-col en-script">
                {enData.script.sections.map((s) => (
                  <div className="en-sec" key={s.no}>
                    <div className="st"><span className="no">§{s.no}</span>{s.title}</div>
                    {s.beats.map((b, i) => <div className="beat" key={i}>{b.text}{b.click && <span className="click"> (click)</span>}</div>)}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      <div className="ew-grid">
        {/* ---------- left rail ---------- */}
        <aside className="rail">
          <section className="card">
            <h2>AI 편집 어시스턴트</h2>
            <div className="chat">
              {chat.map((m, i) => (
                <div key={i} className={`msg ${m.role}`}>{m.text}</div>
              ))}
            </div>
            <div className="chat-in">
              <textarea
                className="tx"
                rows={2}
                placeholder="수정 요청을 입력…"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) sendEdit(); }}
              />
              <button className="primary sm" disabled={sending || !chatInput.trim()} onClick={sendEdit}>
                {sending ? "…" : "보내기"}
              </button>
            </div>
            <p className="hint">⌘/Ctrl + Enter 로 전송. 부분만 수정됩니다.</p>
          </section>

          <section className="card">
            <h2>AI 챗봇 — 결과물에 대해 질문</h2>
            <div className="chat">
              {askChat.map((m, i) => (
                <div key={i} className={`msg ${m.role}`}>{m.text}</div>
              ))}
              {asking && <div className="msg assistant">답변 생성 중…</div>}
            </div>
            <div className="chat-in">
              <textarea
                className="tx"
                rows={2}
                placeholder="예: 슬라이드 구성을 설명해줘 / 경쟁사 비교는 어디 있어?"
                value={askInput}
                onChange={(e) => setAskInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) sendAsk(); }}
              />
              <button className="primary sm" disabled={asking || !askInput.trim()} onClick={sendAsk}>
                {asking ? "…" : "질문"}
              </button>
            </div>
            <p className="hint">⌘/Ctrl + Enter 로 전송. 설명만 하고 문서는 바꾸지 않습니다.</p>
          </section>

          {result.gap && (
            <section className="card">
              <h2>Gap 분석 (SparkLabs 기준)</h2>
              <GapReport gap={result.gap} />
            </section>
          )}

          <section className="card">
            <h2>버전 히스토리</h2>
            <ul className="vers">
              {versions.slice().reverse().map((v) => (
                <li key={v.label}>
                  <div>
                    <span className="vlabel">{v.label}</span>
                    <span className="vnote">{v.note}</span>
                  </div>
                  <button className="ghost xs" onClick={() => restore(v)}>복원</button>
                </li>
              ))}
            </ul>
          </section>

          <section className="card">
            <h2>미해결 트래커 ({tracker.length})</h2>
            {tracker.length === 0 ? (
              <div className="empty">✅ 미해결 항목 없음</div>
            ) : (
              <ul className="tracker">
                {tracker.map((it) => (
                  <li key={it.index}>
                    <span className={`tag ${it.kind === "CONFIRM" ? "confirm" : "needs"}`}>
                      {it.kind === "CONFIRM" ? "확인" : "자료"}
                    </span>
                    <div>
                      <div>{it.message}</div>
                      <div className="loc">{it.locationRef}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {result.review.length > 0 && (
            <section className="card">
              <h2>AI Review ({result.review.length})</h2>
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
            </section>
          )}
        </aside>

        {/* ---------- split view (draggable divider) ---------- */}
        <div className="split" ref={splitRef} style={{ ["--split-cols" as string]: `${splitPct}% 12px 1fr` } as React.CSSProperties}>
          {/* Script */}
          <section className="pane">
            <div className="pane-h">Script <span className="muted">— 대본 (인라인 편집)</span></div>
            <div className="pane-body">
              {script.sections.map((s, si) => (
                <div
                  key={si}
                  ref={(el) => { sectionRefs.current.set(s.no, el); }}
                  className={`sec-block${hlSection === s.no ? " hl" : ""}`}
                >
                  <div className="sec-head">
                    <span className="no">§{s.no}</span>
                    <input
                      className="tin"
                      value={s.title}
                      onChange={(e) => editScript((d) => { d.sections[si]!.title = e.target.value; })}
                    />
                    <button className="ghost xs" title="이 섹션 슬라이드로 이동" onClick={() => goSlidesFor(s.no)}>▸ 슬라이드</button>
                  </div>
                  {s.beats.map((b, bi) => {
                    const hasConfirm = CONFIRM_RE.test(b.text); CONFIRM_RE.lastIndex = 0;
                    return (
                      <div key={bi} className="beat-edit">
                        <textarea
                          className={`tx${hasConfirm ? " has-flag" : ""}`}
                          rows={1}
                          value={b.text}
                          onChange={(e) => editScript((d) => { d.sections[si]!.beats[bi]!.text = e.target.value; })}
                        />
                        <div className="beat-tools">
                          <label className="clk">
                            <input
                              type="checkbox"
                              checked={b.click}
                              onChange={() => editScript((d) => { const beat = d.sections[si]!.beats[bi]!; beat.click = !beat.click; })}
                            />
                            (click)
                          </label>
                          <button className="ghost xs" onClick={() => editScript((d) => { d.sections[si]!.beats.splice(bi, 1); })}>삭제</button>
                        </div>
                      </div>
                    );
                  })}
                  <button className="ghost xs add" onClick={() => editScript((d) => { d.sections[si]!.beats.push({ text: "", click: false }); })}>+ 대사 추가</button>
                </div>
              ))}
            </div>
          </section>

          {/* draggable divider */}
          <div className="split-divider" onMouseDown={startResize} role="separator" aria-orientation="vertical" title="드래그해서 좌우 비율 조정 (더블클릭: 초기화)" onDoubleClick={() => setSplitPct(50)} />

          {/* Skeleton — live slide preview + inspector */}
          <section className="pane">
            <div className="pane-h">슬라이드 <span className="muted">— 클릭하면 편집칸이 열리고, 수정은 즉시 반영됩니다</span></div>
            <div className="pane-body">
              <VariantPicker skeleton={skeleton} value={variant} onChange={chooseVariant} />
              {skeleton.slides.map((sl, sli) => {
                const open = openSlide === sl.no;
                return (
                  <div
                    key={sli}
                    ref={(el) => { slideRefs.current.set(sl.no, el); }}
                    className={`slide-edit${hlSlide === sl.no ? " hl" : ""}${open ? " open" : ""}`}
                  >
                    <div className="slide-h">
                      <span className="sec">{sectionTitleOf(sl.sectionKey)}</span>
                      <span>Slide {sl.no}</span>
                      <span className="layout-chip">{sl.layout}</span>
                      {sl.scriptRefs.map((r, ri) => {
                        const no = refToSectionNo(r);
                        return no ? (
                          <button key={ri} className="ref-chip" title="연결된 스크립트로 이동" onClick={() => goSection(no)}>§{no}</button>
                        ) : null;
                      })}
                      <div className="spacer" />
                      <button className="ghost xs" onClick={() => editSkeleton((d) => { d.slides.splice(sli + 1, 0, { ...emptySlide(0), sectionKey: sl.sectionKey }); renumberSlides(d); })}>+ 아래 추가</button>
                      <button className="ghost xs del" onClick={() => editSkeleton((d) => { d.slides.splice(sli, 1); renumberSlides(d); })}>삭제</button>
                    </div>

                    <div className="canvas-wrap" onClick={() => setOpenSlide(open ? null : sl.no)} title={open ? "편집칸 접기" : "클릭해 편집"}>
                      <SlideCanvas
                        slide={sl}
                        accentColor={skeleton.accentColor}
                        variant={variant}
                        pageNo={sl.no}
                        total={skeleton.slides.length}
                        sectionTitle={sectionTitleOf(sl.sectionKey)}
                        brand={brandMark(skeleton.companyName)}
                      />
                    </div>

                    <SlideChecklist slide={sl} />

                    {sl.flags.length > 0 && (
                      <div className="flags">
                        {sl.flags.map((f, fi) => <span className="fl" key={fi}>⚠ {f.message}</span>)}
                      </div>
                    )}

                    {open && <SlideInspector slide={sl} patch={(mut) => patchSlide(sli, mut)} />}
                  </div>
                );
              })}
              <button className="ghost xs add" onClick={() => editSkeleton((d) => { d.slides.push(emptySlide(d.slides.length + 1)); })}>+ 슬라이드 추가</button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
