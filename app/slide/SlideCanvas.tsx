"use client";

/**
 * SlideCanvas — live HTML render of a Slide, 16:9, matching the pptx export.
 *
 * Font sizes use `cqw` (container-query width) units so 1 unit ≈ pptx point on
 * a 13.333in-wide slide (960pt). fs(28) → the same visual weight as a 28pt
 * pptx headline. The canvas declares `container-type: inline-size`, so it scales
 * to whatever width its parent gives it.
 *
 * DESIGN: every content slide carries a branded header — a section number chip,
 * the section name, a brand wordmark, and a title BAND — so the deck reads as a
 * designed pitch deck rather than a bare template. Keep this in lock-step with
 * src/render/pptx.ts (preview == export).
 */

import { resolveTheme, seriesColors, CSS_CARD_SHADOW, type DeckTheme } from "@engine/domain/deckTheme.js";
import { CANONICAL_ORDER, SECTION_LABEL } from "@engine/domain/houseStyle.js";
import type { ChartSpec, Slide, SlideOffsets, SlideStatus } from "../types";

const h = (c: string) => (c.startsWith("#") ? c : `#${c}`);
/** first grapheme of a name → monogram (falls back to •). */
const monogram = (name: string) => (name || "").trim()[0]?.toUpperCase() ?? "•";
/** section number "01".."12" from the canonical order (0 → ""). */
const sectionNo = (key: string) => {
  const i = CANONICAL_ORDER.indexOf(key);
  return i >= 0 ? String(i + 1).padStart(2, "0") : "";
};

/* consulting status badge (Missing / Needs Input / Recommend) */
export const STATUS_META: Record<SlideStatus, { label: string; bg: string; fg: string }> = {
  missing: { label: "MISSING", bg: "#B42318", fg: "#fff" },
  needs_input: { label: "NEEDS INPUT", bg: "#B9820B", fg: "#fff" },
  recommend: { label: "RECOMMEND", bg: "#2E5AAC", fg: "#fff" },
  ok: { label: "OK", bg: "#0E7C5A", fg: "#fff" },
};

function StatusBadge({ status }: { status: SlideStatus }) {
  const m = STATUS_META[status];
  return (
    <div style={{
      position: "absolute", top: "2.6cqw", right: "3cqw", zIndex: 5,
      display: "inline-flex", alignItems: "center", gap: "0.7cqw",
      background: "rgba(255,255,255,.75)", color: m.bg, fontSize: fs(8.5), fontWeight: 800,
      letterSpacing: "0.08em", padding: "0.5cqw 1cqw", borderRadius: "3cqw",
      border: `1px solid ${m.bg}33`, backdropFilter: "blur(2px)",
    }}>
      <span style={{ width: "1.1cqw", height: "1.1cqw", borderRadius: "50%", background: m.bg }} />
      {m.label}
    </div>
  );
}
/** pptx pt → cqw (960pt across the slide width) */
const fs = (pt: number) => `${(pt / 9.6).toFixed(2)}cqw`;

/**
 * Per-element position nudge. dx = % of slide width, dy = % of slide height.
 * Because cqw = % of container (slide) width, vertical %-of-height is scaled by
 * the 16:9 ratio (height = 0.5625 × width). Clamped so nothing flies off-slide.
 *
 * Uses position:relative + top/left rather than `transform: translate(...)`:
 * container-query units (cqw) are NOT honored inside `transform` by some engines
 * (even though they work for width/font-size), so a translate silently did
 * nothing on screen. top/left resolve cqw as a normal length and render
 * reliably. Still purely visual — the element keeps its slot, siblings don't
 * reflow — matching the pptx offset.
 */
function offStyle(o?: { dx: number; dy: number }): React.CSSProperties {
  if (!o || (!o.dx && !o.dy)) return {};
  const cl = (v: number) => Math.max(-60, Math.min(60, v || 0));
  return { position: "relative", left: `${cl(o.dx)}cqw`, top: `${(cl(o.dy) * 0.5625).toFixed(3)}cqw` };
}

/** Sum the offsets of one or more element keys (e.g. header + headline). */
function offOf(offsets: SlideOffsets | undefined, ...keys: string[]): { dx: number; dy: number } | undefined {
  if (!offsets) return undefined;
  let dx = 0, dy = 0, has = false;
  for (const k of keys) {
    const o = offsets[k];
    if (o) { dx += o.dx || 0; dy += o.dy || 0; has = true; }
  }
  return has ? { dx, dy } : undefined;
}

/* highlight [CONFIRM:...] / [NEEDS INPUT:...] inline */
function Marked({ text }: { text: string }) {
  const parts = text.split(/(\[CONFIRM:[^\]]*\]|\[NEEDS INPUT:[^\]]*\])/g);
  return (
    <>
      {parts.map((p, i) =>
        /^\[(CONFIRM|NEEDS INPUT):/.test(p) ? (
          <span key={i} style={{ color: "#B42318", fontWeight: 700, fontStyle: "italic" }}>{p}</span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

/* ---------------- mini SVG chart ---------------- */
function MiniChart({ chart, theme, offset }: { chart: ChartSpec; theme: DeckTheme; offset?: { dx: number; dy: number } }) {
  const colors = seriesColors(theme);
  const hasData = chart.series.length > 0 && chart.series.some((s) => s.values.length > 0);
  if (!hasData) {
    return (
      <div style={{
        border: `1px dashed ${h(theme.line)}`, borderRadius: "1cqw", background: h(theme.panel),
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        textAlign: "center", padding: "2cqw", height: "100%", color: h(theme.muted),
        ...offStyle(offset),
      }}>
        <div style={{ fontSize: fs(13), fontWeight: 700, color: "#B42318" }}>📊 차트 자리 — 자료 수치 필요</div>
        <div style={{ fontSize: fs(10), marginTop: "1cqw" }}>
          {chart.categories.length ? `축: ${chart.categories.join(" · ")}` : "업로드 자료의 실제 수치를 넣으면 그려집니다"}
        </div>
      </div>
    );
  }
  const W = 100, H = 62, pad = 8;
  const cats = chart.categories.length ? chart.categories : chart.series[0]!.values.map((_, i) => String(i + 1));
  const allVals = chart.series.flatMap((s) => s.values);
  const max = Math.max(1, ...allVals);

  const plotW = W - pad * 2, plotH = H - pad * 2;
  const x0 = pad, y0 = H - pad;

  let body: React.ReactNode = null;
  if (chart.type === "pie") {
    const vals = chart.series[0]!.values;
    const total = vals.reduce((a, b) => a + b, 0) || 1;
    let acc = 0; const cx = W / 2, cy = H / 2, r = Math.min(plotW, plotH) / 2;
    body = (
      <>
        {vals.map((v, i) => {
          const a0 = (acc / total) * Math.PI * 2 - Math.PI / 2; acc += v;
          const a1 = (acc / total) * Math.PI * 2 - Math.PI / 2;
          const large = a1 - a0 > Math.PI ? 1 : 0;
          // Round trig-derived coords to fixed precision so the server- and
          // client-rendered `d` string match exactly (avoids the same
          // floating-point hydration mismatch fixed in SparkLogo).
          const r6 = (x: number) => Number(x.toFixed(6));
          const p = `M${cx},${cy} L${r6(cx + r * Math.cos(a0))},${r6(cy + r * Math.sin(a0))} A${r},${r} 0 ${large} 1 ${r6(cx + r * Math.cos(a1))},${r6(cy + r * Math.sin(a1))} Z`;
          return <path key={i} d={p} fill={h(colors[i % colors.length]!)} />;
        })}
      </>
    );
  } else if (chart.type === "line" || chart.type === "area") {
    body = (
      <>
        {chart.series.map((s, si) => {
          const pts = s.values.map((v, i) => {
            const x = x0 + (s.values.length === 1 ? plotW / 2 : (i / (s.values.length - 1)) * plotW);
            const y = y0 - (v / max) * plotH;
            return [x, y] as const;
          });
          const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join(" ");
          const col = h(colors[si % colors.length]!);
          return (
            <g key={si}>
              {chart.type === "area" && (
                <path d={`${line} L${pts[pts.length - 1]![0]},${y0} L${pts[0]![0]},${y0} Z`} fill={col} opacity={0.15} />
              )}
              <path d={line} fill="none" stroke={col} strokeWidth={1.4} />
              {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={1.3} fill={col} />)}
            </g>
          );
        })}
      </>
    );
  } else {
    // bar (grouped)
    const groups = cats.length;
    const gW = plotW / groups;
    const ns = chart.series.length;
    const bW = (gW * 0.7) / ns;
    const single = chart.series.length === 1;
    body = (
      <>
        {cats.map((_, gi) =>
          chart.series.map((s, si) => {
            const v = s.values[gi] ?? 0;
            const bh = (v / max) * plotH;
            const x = x0 + gi * gW + gW * 0.15 + si * bW;
            // single series → emphasize the last (latest / target) bar in accent2
            const col = single ? (gi === cats.length - 1 ? theme.accent2 : theme.accent) : colors[si % colors.length]!;
            return <rect key={`${gi}-${si}`} x={x} y={y0 - bh} width={bW * 0.9} height={bh} rx={0.6} fill={h(col)} />;
          }),
        )}
      </>
    );
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", ...offStyle(offset) }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", flex: 1, minHeight: 0 }}>
        {chart.type !== "pie" && <line x1={x0} y1={y0} x2={W - pad} y2={y0} stroke={h(theme.line)} strokeWidth={0.5} />}
        {body}
      </svg>
      <div style={{ display: "flex", gap: "1.5cqw", flexWrap: "wrap", justifyContent: "center", marginTop: "0.8cqw" }}>
        {(chart.type === "pie" ? cats : chart.series.map((s) => s.name)).map((label, i) => (
          <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: "0.6cqw", fontSize: fs(9), color: h(theme.muted) }}>
            <span style={{ width: "1.4cqw", height: "1.4cqw", borderRadius: "50%", background: h(colors[i % colors.length]!) }} />
            {label}
          </span>
        ))}
      </div>
      {!chart.confirmed && (
        <div style={{ fontSize: fs(8.5), fontStyle: "italic", color: "#B42318", textAlign: "right" }}>확인 필요</div>
      )}
    </div>
  );
}

/* ---------------- building blocks ---------------- */

/** Bullets rendered as "point cards" — never a naked list. 1 col for ≤3, else 2. */
function Bullets({ slide, theme, fill }: { slide: Slide; theme: DeckTheme; fill?: boolean }) {
  const items = slide.bullets;
  if (!items.length) return null;
  const twoCol = !fill && items.length >= 4;
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: twoCol ? "1fr 1fr" : "1fr",
      gap: twoCol ? "1.6cqw 1.8cqw" : "1.5cqw",
      width: "100%", alignContent: "center",
      ...offStyle(slide.offsets?.bullets),
    }}>
      {items.map((b, i) => {
        const em = b.emphasis;
        return (
          <div key={i} style={{
            display: "flex", gap: "1.4cqw", alignItems: "flex-start",
            background: em ? h(theme.accentSoft) : h(theme.panel),
            border: `1px solid ${em ? h(theme.accent) + "55" : h(theme.line)}`,
            borderLeft: `0.7cqw solid ${h(theme.accent)}`,
            borderRadius: "0.9cqw", padding: "1.5cqw 1.8cqw",
            boxShadow: CSS_CARD_SHADOW,
          }}>
            <span style={{
              flex: "none", width: "1.5cqw", height: "1.5cqw", marginTop: "0.5cqw",
              borderRadius: "0.35cqw", background: h(theme.accent),
              transform: "rotate(45deg)", opacity: em ? 1 : 0.85,
            }} />
            <span style={{ fontSize: fs(em ? 16.5 : 15.5), fontWeight: em ? 700 : 500, color: h(em ? theme.ink : theme.ink), lineHeight: 1.32 }}>
              <Marked text={b.text} />
            </span>
          </div>
        );
      })}
    </div>
  );
}

function VisualBox({ slide, theme }: { slide: Slide; theme: DeckTheme }) {
  const need = slide.visual.needsAsset;
  const kindLabel: Record<string, string> = { image: "이미지", screenshot: "실제 스크린샷", diagram: "다이어그램", logo: "로고", none: "비주얼" };
  return (
    <div style={{
      height: "100%", minHeight: "22cqw", border: `1.5px dashed ${need ? "#F0B4AD" : h(theme.line)}`, borderRadius: "1.2cqw",
      background: need ? "#FDF3F2" : h(theme.panel), padding: "2cqw", display: "flex", flexDirection: "column", gap: "1cqw",
      justifyContent: "center",
      ...offStyle(slide.offsets?.visual),
    }}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: "0.8cqw", fontSize: fs(11), fontWeight: 700, color: need ? "#B42318" : h(theme.muted) }}>
        <span style={{ fontSize: fs(15) }}>🖼</span>
        {kindLabel[slide.visual.kind] ?? "비주얼"}{need ? " · 실제 자료 필요" : ""}
      </div>
      <div style={{ fontSize: fs(11.5), color: h(theme.ink), lineHeight: 1.35 }}>{slide.visual.direction || "(이미지 방향 미지정)"}</div>
    </div>
  );
}

function Metrics({ slide, theme }: { slide: Slide; theme: DeckTheme }) {
  const n = Math.min(slide.metrics.length, 4);
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${n}, 1fr)`, gap: "1.8cqw", width: "100%", ...offStyle(slide.offsets?.metrics) }}>
      {slide.metrics.slice(0, 4).map((m, i) => {
        const hero = i === 0;
        return (
          <div key={i} style={{
            position: "relative",
            background: hero ? h(theme.accentSoft) : h(theme.bg),
            border: `1px solid ${hero ? h(theme.accent) + "44" : h(theme.line)}`,
            borderRadius: "1.1cqw", padding: "2.4cqw 1.8cqw 1.9cqw", overflow: "hidden",
            boxShadow: CSS_CARD_SHADOW, display: "flex", flexDirection: "column",
            ...offStyle(offOf(slide.offsets, `metrics.${i}`)),
          }}>
            <span style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "0.6cqw", background: h(theme.accent) }} />
            <div style={{ fontSize: fs(46), fontWeight: 800, letterSpacing: "-0.035em", color: h(hero ? theme.accent : theme.ink), lineHeight: 0.98, fontVariantNumeric: "tabular-nums" }}><Marked text={m.value} /></div>
            <div style={{ fontSize: fs(13), fontWeight: 700, color: h(theme.ink), marginTop: "1.4cqw" }}>{m.label}</div>
            {m.sub && <div style={{ fontSize: fs(10.5), fontWeight: 600, color: h(theme.accent2), marginTop: "0.5cqw" }}>{m.sub}</div>}
          </div>
        );
      })}
    </div>
  );
}

function Comparison({ slide, theme }: { slide: Slide; theme: DeckTheme }) {
  const n = Math.min(slide.columns.length, 3);
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${n}, 1fr)`, gap: "1.8cqw", width: "100%", height: "100%", ...offStyle(slide.offsets?.columns) }}>
      {slide.columns.slice(0, 3).map((c, i) => {
        const accent = !!c.accent;
        return (
          <div key={i} style={{
            display: "flex", flexDirection: "column",
            background: h(theme.bg),
            border: `1.5px solid ${accent ? h(theme.accent) : h(theme.line)}`,
            borderRadius: "1.1cqw", overflow: "hidden",
            boxShadow: CSS_CARD_SHADOW,
            ...offStyle(offOf(slide.offsets, `columns.${i}`)),
          }}>
            {/* header strip */}
            <div style={{
              background: accent ? h(theme.accent) : h(theme.panel),
              padding: "1.5cqw 1.7cqw", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1cqw",
            }}>
              <span style={{ fontSize: fs(16.5), fontWeight: 800, letterSpacing: "-0.01em", color: accent ? "#fff" : h(theme.ink) }}>{c.heading}</span>
              {accent && <span style={{ flex: "none", fontSize: fs(9.5), fontWeight: 800, letterSpacing: "0.1em", color: h(theme.accent), background: "#fff", padding: "0.4cqw 1cqw", borderRadius: "3cqw" }}>추천</span>}
            </div>
            <ul style={{ listStyle: "none", margin: 0, padding: "1.6cqw 1.7cqw", display: "flex", flexDirection: "column", gap: "1.2cqw", flex: 1 }}>
              {c.items.map((it, j) => (
                <li key={j} style={{ display: "flex", gap: "1.1cqw", fontSize: fs(13.5), color: h(theme.ink), lineHeight: 1.3, alignItems: "flex-start" }}>
                  <span style={{ flex: "none", color: h(accent ? theme.accent : theme.muted), fontWeight: 800, marginTop: "0.1cqw" }}>{accent ? "✓" : "•"}</span>
                  <span><Marked text={it} /></span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function Process({ slide, theme }: { slide: Slide; theme: DeckTheme }) {
  const steps = slide.steps.slice(0, 5);
  return (
    <div style={{ position: "relative", display: "flex", alignItems: "stretch", gap: "1.4cqw", width: "100%", ...offStyle(slide.offsets?.steps) }}>
      {/* connector line behind the cards */}
      <div style={{ position: "absolute", left: "3cqw", right: "3cqw", top: "3.6cqw", height: "0.3cqw", background: h(theme.line), zIndex: 0 }} />
      {steps.map((s, i) => (
        <div key={i} style={{ flex: 1, position: "relative", zIndex: 1, background: h(theme.bg), border: `1px solid ${h(theme.line)}`, borderRadius: "1.1cqw", padding: "1.8cqw 1.6cqw", boxShadow: CSS_CARD_SHADOW, ...offStyle(offOf(slide.offsets, `steps.${i}`)) }}>
          <div style={{ width: "4.4cqw", height: "4.4cqw", borderRadius: "50%", background: h(theme.accent), color: h(theme.onAccent), display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: fs(18) }}>{i + 1}</div>
          <div style={{ fontSize: fs(14.5), fontWeight: 700, color: h(theme.ink), marginTop: "1.2cqw" }}>{s.title}</div>
          {s.detail && <div style={{ fontSize: fs(11), color: h(theme.muted), marginTop: "0.7cqw", lineHeight: 1.32 }}>{s.detail}</div>}
        </div>
      ))}
    </div>
  );
}

function Team({ slide, theme }: { slide: Slide; theme: DeckTheme }) {
  const n = Math.min(slide.team.length, 4);
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${n}, 1fr)`, gap: "1.8cqw", width: "100%", ...offStyle(slide.offsets?.team) }}>
      {slide.team.slice(0, 4).map((t, i) => (
        <div key={i} style={{ background: h(theme.bg), border: `1px solid ${h(theme.line)}`, borderRadius: "1.1cqw", padding: "2cqw 1.6cqw", textAlign: "center", boxShadow: CSS_CARD_SHADOW, ...offStyle(offOf(slide.offsets, `team.${i}`)) }}>
          <div style={{ width: "8cqw", height: "8cqw", borderRadius: "50%", background: h(theme.accentSoft), border: `0.4cqw solid ${h(theme.accent)}33`, color: h(theme.accent), margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "center", fontSize: fs(32), fontWeight: 800 }}>{monogram(t.name)}</div>
          <div style={{ fontSize: fs(15), fontWeight: 800, color: h(theme.ink), marginTop: "1.2cqw" }}>{t.name}</div>
          <div style={{ fontSize: fs(11), fontWeight: 600, color: h(theme.accent), marginTop: "0.4cqw" }}>{t.role ?? ""}{t.fullTime === false ? " · 파트타임" : t.fullTime ? " · 풀타임" : ""}</div>
          {t.note && <div style={{ fontSize: fs(10), color: h(theme.muted), marginTop: "0.7cqw", lineHeight: 1.32 }}>{t.note}</div>}
        </div>
      ))}
    </div>
  );
}

/* ---------------- header chrome ---------------- */
function SectionHeader({ slide, theme, brand, badgePresent }: { slide: Slide; theme: DeckTheme; brand?: string; badgePresent?: boolean }) {
  const o = slide.offsets;
  const style = theme.style;
  const banded = style.cover !== "light"; // minimal + bold get a title band; editorial stays open
  const bold = style.panel === "tint";     // bold variant → solid accent band
  const no = sectionNo(slide.sectionKey);
  const secLabel = SECTION_LABEL[slide.sectionKey] || "";
  const serif = theme.fontHead === "바탕";
  const serifFam = serif ? "'바탕','Batang',serif" : undefined;

  const bandBg = bold ? h(theme.accent) : h(theme.accentSoft);
  const bandInk = bold ? "#fff" : h(theme.ink);
  const bandSub = bold ? "rgba(255,255,255,.85)" : h(theme.muted);

  return (
    <div style={{ flex: "none", ...offStyle(o?.header) }}>
      {/* kicker row: section number + name (left), brand wordmark (right) */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.3cqw", ...offStyle(offOf(o, "eyebrow")) }}>
        <div style={{ display: "flex", alignItems: "center", gap: "1.1cqw" }}>
          {no && <span style={{ fontSize: fs(12), fontWeight: 800, color: h(theme.onAccent), background: h(theme.accent), padding: "0.5cqw 1.1cqw", borderRadius: "0.5cqw", letterSpacing: "0.02em" }}>{no}</span>}
          <span style={{ fontSize: fs(12.5), fontWeight: 800, letterSpacing: "0.16em", color: h(theme.ink), textTransform: "uppercase" }}>{slide.eyebrow || secLabel}</span>
        </div>
        {brand && !badgePresent && <span style={{ fontSize: fs(11), fontWeight: 800, letterSpacing: "0.22em", color: h(theme.faint), textTransform: "uppercase" }}>{brand}</span>}
      </div>

      {/* title band */}
      {banded ? (
        <div style={{
          background: bandBg, borderRadius: "0.9cqw",
          borderLeft: bold ? undefined : `0.8cqw solid ${h(theme.accent)}`,
          padding: bold ? "1.7cqw 2cqw" : "1.5cqw 1.9cqw",
          ...offStyle(offOf(o, "headline")),
        }}>
          <div style={{ fontSize: fs(26), fontWeight: 800, letterSpacing: "-0.02em", color: bandInk, lineHeight: 1.14, fontFamily: serifFam }}><Marked text={slide.headline || " "} /></div>
          {slide.subhead && <div style={{ fontSize: fs(13.5), color: bandSub, marginTop: "0.7cqw", lineHeight: 1.3 }}><Marked text={slide.subhead} /></div>}
        </div>
      ) : (
        <div style={{ ...offStyle(offOf(o, "headline")) }}>
          <div style={{ display: "flex", gap: "1.2cqw", alignItems: "stretch" }}>
            <span style={{ flex: "none", width: "0.55cqw", background: h(theme.accent), borderRadius: "0.3cqw" }} />
            <div>
              <div style={{ fontSize: fs(28), fontWeight: 700, letterSpacing: "-0.01em", color: h(theme.ink), lineHeight: 1.12, fontFamily: serifFam }}><Marked text={slide.headline || " "} /></div>
              {slide.subhead && <div style={{ fontSize: fs(14), color: h(theme.muted), marginTop: "0.7cqw", lineHeight: 1.3 }}><Marked text={slide.subhead} /></div>}
            </div>
          </div>
          <div style={{ width: "100%", height: "0.12cqw", background: h(theme.line), marginTop: "1.4cqw" }} />
        </div>
      )}
    </div>
  );
}

/* ---------------- main ---------------- */
export default function SlideCanvas({ slide, accentColor, variant, pageNo = 1, total = 1, sectionTitle = "", brand }: {
  slide: Slide; accentColor?: string; variant?: string; pageNo?: number; total?: number; sectionTitle?: string; brand?: string;
}) {
  const theme = resolveTheme(accentColor, variant);
  const badge = slide.status && slide.status !== "ok" ? <StatusBadge status={slide.status} /> : null;
  const canvas: React.CSSProperties = {
    containerType: "inline-size",
    aspectRatio: "16 / 9",
    width: "100%",
    background: h(theme.bg),
    borderRadius: "1cqw",
    overflow: "hidden",
    position: "relative",
    boxShadow: "0 1px 3px rgba(0,0,0,.12), 0 8px 24px rgba(0,0,0,.06)",
    color: h(theme.ink),
    fontFamily: "'맑은 고딕','Malgun Gothic',system-ui,sans-serif",
  };

  // full-bleed layouts
  const cover = theme.style.cover; // "dark" | "band" | "light"
  const o = slide.offsets;
  if (slide.layout === "cover") {
    const bg = cover === "band" ? h(theme.accent) : cover === "light" ? h(theme.bg) : h(theme.ink);
    const onDark = cover !== "light";
    const headColor = cover === "band" ? "#fff" : cover === "light" ? h(theme.ink) : "#fff";
    const subColor = cover === "band" ? "#F3FBF8" : cover === "light" ? h(theme.muted) : "#C9D2E3";
    const ebColor = cover === "band" ? "#fff" : cover === "light" ? h(theme.accent) : h(theme.accent2);
    return (
      <div style={{ ...canvas, background: bg }}>
        {badge}
        {/* geometric accents (match pptx cover) */}
        {cover === "dark" && <>
          <div style={{ position: "absolute", right: "-8cqw", top: "-14cqw", width: "38cqw", height: "38cqw", borderRadius: "3cqw", background: h(theme.accent), opacity: 0.18, transform: "rotate(12deg)" }} />
          <div style={{ position: "absolute", right: "6cqw", bottom: "-16cqw", width: "34cqw", height: "34cqw", borderRadius: "50%", background: h(theme.accent2), opacity: 0.14 }} />
        </>}
        {cover === "band" && <>
          <div style={{ position: "absolute", right: "-6cqw", top: "-14cqw", width: "40cqw", height: "40cqw", borderRadius: "50%", background: "#fff", opacity: 0.1 }} />
          <div style={{ position: "absolute", right: "2cqw", bottom: "-18cqw", width: "30cqw", height: "30cqw", borderRadius: "3cqw", background: h(theme.ink), opacity: 0.16, transform: "rotate(14deg)" }} />
        </>}
        {cover === "light" && <div style={{ position: "absolute", right: "-6cqw", top: "-12cqw", width: "34cqw", height: "34cqw", borderRadius: "3cqw", background: h(theme.accent), opacity: 0.1, transform: "rotate(12deg)" }} />}
        {brand && <div style={{ position: "absolute", top: "5cqw", right: "6cqw", fontSize: fs(12), fontWeight: 800, letterSpacing: "0.24em", color: onDark ? "rgba(255,255,255,.9)" : h(theme.ink) }}>{brand.toUpperCase()}</div>}
        <div style={{ position: "absolute", inset: 0, padding: cover === "light" ? "8cqw 6cqw 8cqw 7cqw" : "8cqw 6cqw", display: "flex", flexDirection: "column", justifyContent: "center" }}>
          {cover === "light" && <div style={{ position: "absolute", left: "5cqw", top: "30%", bottom: "30%", width: "0.6cqw", background: h(theme.accent) }} />}
          {slide.eyebrow && <div style={{ fontSize: fs(14), fontWeight: 700, letterSpacing: "0.2em", color: ebColor, marginBottom: "1.4cqw", ...offStyle(offOf(o, "eyebrow")) }}>{slide.eyebrow.toUpperCase()}</div>}
          <div style={{ fontSize: fs(52), fontWeight: 800, letterSpacing: "-0.02em", color: headColor, lineHeight: 1.03, maxWidth: "82%", fontFamily: theme.fontHead === "바탕" ? "'바탕','Batang',serif" : undefined, ...offStyle(offOf(o, "headline")) }}>{slide.headline}</div>
          {slide.subhead && <div style={{ fontSize: fs(20), color: subColor, marginTop: "2cqw", maxWidth: "78%", ...offStyle(offOf(o, "subhead")) }}>{slide.subhead}</div>}
          {slide.bullets.length > 0 && <div style={{ fontSize: fs(14), color: onDark ? "#DFF4EC" : h(theme.faint), marginTop: "2.4cqw", ...offStyle(offOf(o, "bullets")) }}>{slide.bullets.map((b) => b.text).join("   ·   ")}</div>}
        </div>
        {cover !== "light" && <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "2.4cqw", background: cover === "band" ? h(theme.ink) : h(theme.accent) }} />}
      </div>
    );
  }
  if (slide.layout === "statement") {
    return (
      <div style={{ ...canvas, background: h(theme.ink) }}>
        {badge}
        <div style={{ position: "absolute", left: "-10cqw", top: "-10cqw", width: "34cqw", height: "34cqw", borderRadius: "50%", background: h(theme.accent), opacity: 0.16 }} />
        <div style={{ position: "absolute", right: "-8cqw", bottom: "-12cqw", width: "30cqw", height: "30cqw", borderRadius: "3cqw", transform: "rotate(12deg)", background: h(theme.accent2), opacity: 0.14 }} />
        <div style={{ position: "absolute", inset: 0, padding: "6cqw", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
          {slide.eyebrow && <div style={{ fontSize: fs(13), fontWeight: 700, letterSpacing: "0.2em", color: h(theme.accent2), marginBottom: "1.6cqw", ...offStyle(offOf(o, "eyebrow")) }}>{slide.eyebrow.toUpperCase()}</div>}
          <div style={{ fontSize: fs(40), fontWeight: 800, color: "#fff", lineHeight: 1.16, maxWidth: "84%", fontFamily: theme.fontHead === "바탕" ? "'바탕','Batang',serif" : undefined, ...offStyle(offOf(o, "headline")) }}><Marked text={slide.headline} /></div>
          {slide.subhead && <div style={{ fontSize: fs(18), color: "#C9D2E3", marginTop: "2cqw", maxWidth: "72%", ...offStyle(offOf(o, "subhead")) }}><Marked text={slide.subhead} /></div>}
        </div>
      </div>
    );
  }
  if (slide.layout === "closing") {
    const light = cover === "light";
    const bg = light ? h(theme.bg) : h(theme.ink);
    const headColor = light ? h(theme.ink) : "#fff";
    const bulColor = light ? h(theme.muted) : "#E4E8F0";
    const ebColor = light ? h(theme.accent) : h(theme.accent2);
    return (
      <div style={{ ...canvas, background: bg }}>
        {badge}
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "2.6cqw", background: h(theme.accent) }} />
        <div style={{ position: "absolute", inset: 0, padding: "6cqw 6cqw 6cqw 8cqw", display: "flex", flexDirection: "column", justifyContent: "center" }}>
          {slide.eyebrow && <div style={{ fontSize: fs(14), fontWeight: 700, letterSpacing: "0.2em", color: ebColor, marginBottom: "1.2cqw", ...offStyle(offOf(o, "eyebrow")) }}>{slide.eyebrow.toUpperCase()}</div>}
          <div style={{ fontSize: fs(38), fontWeight: 800, color: headColor, lineHeight: 1.08, fontFamily: theme.fontHead === "바탕" ? "'바탕','Batang',serif" : undefined, ...offStyle(offOf(o, "headline")) }}>{slide.headline}</div>
          <div style={{ display: "flex", gap: "3cqw", marginTop: "2.4cqw", alignItems: "flex-start" }}>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, flex: 1, display: "flex", flexDirection: "column", gap: "1.2cqw", ...offStyle(offOf(o, "bullets")) }}>
              {slide.bullets.map((b, i) => (
                <li key={i} style={{ fontSize: fs(18), color: bulColor, display: "flex", gap: "1cqw" }}><span style={{ color: ebColor }}>▸</span><span><Marked text={b.text} /></span></li>
              ))}
            </ul>
            {(slide.visual.direction || slide.visual.kind === "logo") && (
              <div style={{ width: "34%", minHeight: "16cqw", border: `1px dashed ${h(theme.accent)}`, borderRadius: "1.2cqw", background: light ? h(theme.panel) : "#222C44", padding: "1.6cqw", fontSize: fs(12), color: bulColor, ...offStyle(offOf(o, "visual")) }}>
                {slide.visual.direction || "로고 · 연락처"}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // standard chrome + body layouts
  const hasVisual = slide.visual.kind !== "none" || !!slide.visual.direction;
  const centered = ["process", "team", "comparison", "metrics"].includes(slide.layout);
  let bodyEl: React.ReactNode;
  switch (slide.layout) {
    case "metrics":
      bodyEl = (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.8cqw", height: "100%", justifyContent: "center" }}>
          <Metrics slide={slide} theme={theme} />
          {slide.chart ? <div style={{ flex: 1, minHeight: "12cqw" }}><MiniChart chart={slide.chart} theme={theme} offset={slide.offsets?.chart} /></div> : slide.bullets.length ? <Bullets slide={slide} theme={theme} /> : null}
        </div>
      );
      break;
    case "comparison": bodyEl = <Comparison slide={slide} theme={theme} />; break;
    case "process": bodyEl = <Process slide={slide} theme={theme} />; break;
    case "team": bodyEl = <Team slide={slide} theme={theme} />; break;
    case "chart":
      bodyEl = slide.chart ? (
        slide.bullets.length ? (
          <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: "2.2cqw", height: "100%", alignItems: "center" }}>
            <div style={{ height: "100%", background: h(theme.panel), border: `1px solid ${h(theme.line)}`, borderRadius: "1.1cqw", padding: "1.8cqw" }}><MiniChart chart={slide.chart} theme={theme} offset={slide.offsets?.chart} /></div>
            <Bullets slide={slide} theme={theme} fill />
          </div>
        ) : <div style={{ height: "100%", background: h(theme.panel), border: `1px solid ${h(theme.line)}`, borderRadius: "1.1cqw", padding: "2cqw" }}><MiniChart chart={slide.chart} theme={theme} offset={slide.offsets?.chart} /></div>
      ) : <Bullets slide={slide} theme={theme} />;
      break;
    default: // bullets
      bodyEl = hasVisual ? (
        <div style={{ display: "grid", gridTemplateColumns: "1.25fr 1fr", gap: "2.4cqw", height: "100%", alignItems: "center" }}>
          <Bullets slide={slide} theme={theme} fill />
          <VisualBox slide={slide} theme={theme} />
        </div>
      ) : slide.chart ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2.4cqw", height: "100%", alignItems: "center" }}>
          <Bullets slide={slide} theme={theme} fill />
          <div style={{ height: "100%", background: h(theme.panel), border: `1px solid ${h(theme.line)}`, borderRadius: "1.1cqw", padding: "1.8cqw" }}><MiniChart chart={slide.chart} theme={theme} offset={slide.offsets?.chart} /></div>
        </div>
      ) : <Bullets slide={slide} theme={theme} />;
  }

  return (
    <div style={canvas}>
      {badge}
      <div style={{ position: "absolute", inset: 0, padding: "4.4cqw 4.6cqw 3.4cqw", display: "flex", flexDirection: "column" }}>
        <SectionHeader slide={slide} theme={theme} brand={brand} badgePresent={!!badge} />
        <div style={{ flex: 1, minHeight: 0, marginTop: "2.4cqw", display: "flex", flexDirection: "column", justifyContent: centered ? "center" : "flex-start" }}>
          {bodyEl}
        </div>
        <div style={{ flex: "none", borderTop: `1px solid ${h(theme.line)}`, marginTop: "1.4cqw", paddingTop: "1cqw", display: "flex", justifyContent: "space-between", fontSize: fs(9), color: h(theme.faint) }}>
          <span>{brand ? `${brand} · ${sectionTitle}` : sectionTitle}</span><span>{pageNo} / {total}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Consulting checklist panel shown beside/below a slide — the "이것만 채워오세요"
 * markup. Uses normal CSS classes (see globals.css .slide-checklist*).
 */
export function SlideChecklist({ slide }: { slide: Slide }) {
  if ((!slide.checklist || slide.checklist.length === 0) && !slide.gapNote && (slide.status ?? "ok") === "ok") return null;
  const m = STATUS_META[slide.status ?? "ok"];
  return (
    <div className="slide-checklist">
      <div className="scl-head">
        <span className="scl-badge" style={{ background: m.bg }}>{m.label}</span>
        <span className="scl-title">이 장표 점검</span>
      </div>
      {slide.checklist && slide.checklist.length > 0 && (
        <ul className="scl-list">
          {slide.checklist.map((c, i) => (
            <li key={i} className={c.done ? "done" : "todo"}>
              <span className="scl-box">{c.done ? "☑" : "☐"}</span>
              <span className="scl-label">{c.label}{c.note ? <span className="scl-note"> — {c.note}</span> : null}</span>
            </li>
          ))}
        </ul>
      )}
      {slide.gapNote && <div className="scl-rec">💡 {slide.gapNote}</div>}
    </div>
  );
}
