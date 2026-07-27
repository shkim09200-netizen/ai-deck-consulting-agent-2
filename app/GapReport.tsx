"use client";

import type { GapAnalysis } from "./types";

const COV_LABEL: Record<string, string> = { present: "충족", partial: "부분", missing: "누락" };

/**
 * Gap Analysis report — the consulting diagnosis of the uploaded deck against
 * the SparkLabs standard: storyline verdict, ordering issues, missing sections,
 * and per-section coverage with what's present / missing / to fix.
 */
export default function GapReport({ gap }: { gap: GapAnalysis }) {
  if (!gap) return null;
  return (
    <div className="gap-report">
      {gap.storyline && (
        <div>
          <h3>스토리라인 진단</h3>
          <div className="gap-storyline">{gap.storyline}</div>
        </div>
      )}

      {gap.missingSections.length > 0 && (
        <div>
          <h3>통째로 빠진 섹션 <span className="n" style={{ color: "var(--red)" }}>({gap.missingSections.length})</span></h3>
          <div>{gap.missingSections.map((s, i) => <span className="gap-missing-chip" key={i}>✕ {s}</span>)}</div>
        </div>
      )}

      {gap.orderIssues.length > 0 && (
        <div>
          <h3>순서 · 배치 이슈</h3>
          <div className="gap-warn">
            {gap.orderIssues.map((o, i) => (
              <div className="gw" key={i}><span className="ic">↕</span><span>{o}</span></div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h3>섹션별 SparkLabs 기준 점검</h3>
        <div className="gap-report" style={{ gap: 10 }}>
          {gap.sections.map((s) => (
            <div className="gap-sec" key={s.sectionKey}>
              <div className="gap-sec-head">
                <span className={`cov ${s.coverage}`}>{COV_LABEL[s.coverage] ?? s.coverage}</span>
                <span className="gs-title">{s.title}</span>
              </div>
              {s.items.length > 0 && (
                <ul className="scl-list">
                  {s.items.map((it, i) => (
                    <li key={i} className={it.done ? "done" : "todo"}>
                      <span className="scl-box">{it.done ? "☑" : "☐"}</span>
                      <span className="scl-label">{it.label}{it.note ? <span className="scl-note"> — {it.note}</span> : null}</span>
                    </li>
                  ))}
                </ul>
              )}
              {s.weakness && <div className="gap-weak">⚠ {s.weakness}</div>}
              {s.recommendation && <div className="gap-rec">💡 {s.recommendation}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
