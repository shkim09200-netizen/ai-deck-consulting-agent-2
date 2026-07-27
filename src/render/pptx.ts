import PptxGenJS from "pptxgenjs";
import type { ChartSpec, Slide, SkeletonDoc, SlideOffsets } from "../domain/types.js";
import { SKELETON_STRUCTURE, CANONICAL_ORDER } from "../domain/houseStyle.js";
import { DEFAULT_THEME, resolveTheme, seriesColors, PPTX_CARD_SHADOW, mixWhite, brandMark, type DeckTheme } from "../domain/deckTheme.js";

const CARD_SHADOW = PPTX_CARD_SHADOW as unknown as PptxGenJS.ShadowProps;
/** first grapheme of a name → monogram (falls back to •). */
function monogram(name: string): string {
  const c = (name || "").trim()[0];
  return c ? c.toUpperCase() : "•";
}

const SECTION_TITLE: Record<string, string> = Object.fromEntries(
  SKELETON_STRUCTURE.map((s) => [s.key, s.title]),
);
/** section number "01".."12" from the canonical order (empty if unknown). */
function sectionNo(key: string): string {
  const i = CANONICAL_ORDER.indexOf(key);
  return i >= 0 ? String(i + 1).padStart(2, "0") : "";
}

const M = 0.62; // margin (in)
const W = 13.333;
const H = 7.5;
const CONTENT_W = W - M * 2;

type XY = { ox: number; oy: number };
const ZERO: XY = { ox: 0, oy: 0 };

/** per-element nudge → inches. dx = % of width, dy = % of height (clamped). */
function offIn(o?: { dx: number; dy: number }): XY {
  if (!o) return ZERO;
  const cl = (v: number) => Math.max(-60, Math.min(60, v || 0));
  return { ox: (cl(o.dx) / 100) * W, oy: (cl(o.dy) / 100) * H };
}
const add = (a: XY, b: XY): XY => ({ ox: a.ox + b.ox, oy: a.oy + b.oy });
/** offset for a named element key (e.g. "headline", "metrics.0"). */
function offAt(offsets: SlideOffsets | undefined, key: string): XY {
  return offIn(offsets?.[key]);
}

type Lang = "ko" | "en";
interface Labels {
  memo: string; confirm: string; needAsset: string; chartTitle: string; chartHint: string;
  fullTime: string; partTime: string;
  kind: Record<string, string>;
}
function labels(lang: Lang): Labels {
  return lang === "en"
    ? {
        memo: "Note", confirm: "needs check", needAsset: " · real asset needed",
        chartTitle: "📊 Chart — source figures needed",
        chartHint: "Fill in the real numbers from your source and the chart renders.",
        fullTime: " · full-time", partTime: " · part-time",
        kind: { image: "Image", screenshot: "Actual screenshot", diagram: "Diagram", logo: "Logo", none: "Visual" },
      }
    : {
        memo: "메모", confirm: "확인 필요", needAsset: "  · 실제 자료 필요",
        chartTitle: "📊 차트 자리 — 자료 수치 필요",
        chartHint: "업로드 자료의 실제 수치를 채우면 차트가 그려집니다.",
        fullTime: " · 풀타임", partTime: " · 파트타임",
        kind: { image: "이미지", screenshot: "실제 스크린샷", diagram: "다이어그램", logo: "로고", none: "비주얼" },
      };
}

/* ------------------------------------------------------------------ *
 * inline marker highlighting ([CONFIRM: ...] / [NEEDS INPUT: ...])
 * ------------------------------------------------------------------ */
type Run = { text: string; options: PptxGenJS.TextPropsOptions };

function runs(text: string, base: PptxGenJS.TextPropsOptions, theme: DeckTheme): Run[] {
  const re = /(\[CONFIRM:[^\]]*\]|\[NEEDS INPUT:[^\]]*\])/g;
  const out: Run[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const idx = m.index!;
    if (idx > last) out.push({ text: text.slice(last, idx), options: { ...base } });
    out.push({ text: m[0], options: { ...base, color: "B42318", bold: true, italic: true } });
    last = idx + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), options: { ...base } });
  if (out.length === 0) out.push({ text: text || " ", options: { ...base } });
  return out;
}

/* ------------------------------------------------------------------ *
 * chrome: eyebrow + headline + accent rule + footer
 * ------------------------------------------------------------------ */
function chrome(slide: PptxGenJS.Slide, sl: Slide, theme: DeckTheme, brand: string, pageNo: number, total: number, hasBadge: boolean): number {
  const style = theme.style;
  const banded = style.cover !== "light"; // minimal + bold get a title band; editorial stays open
  const bold = style.panel === "tint";     // bold variant → solid accent band
  const no = sectionNo(sl.sectionKey);
  const secLabel = (sl.eyebrow || SECTION_TITLE[sl.sectionKey] || "").toUpperCase();

  const hdr = offAt(sl.offsets, "header");
  const eb = add(hdr, offAt(sl.offsets, "eyebrow"));
  const hl = add(hdr, offAt(sl.offsets, "headline"));
  const ft = offAt(sl.offsets, "footer");

  // ---- kicker row: section number chip + label (left), brand wordmark (right)
  const ky = 0.5;
  let kx = M + eb.ox;
  if (no) {
    slide.addShape("roundRect" as PptxGenJS.ShapeType, { x: kx, y: ky + eb.oy, w: 0.5, h: 0.32, rectRadius: 0.05, fill: { color: theme.accent } });
    slide.addText(no, { x: kx, y: ky + eb.oy, w: 0.5, h: 0.32, align: "center", valign: "middle", fontSize: 12, bold: true, color: theme.onAccent, fontFace: theme.fontHead });
    kx += 0.64;
  }
  if (secLabel) {
    slide.addText(secLabel, { x: kx, y: ky + eb.oy, w: 8, h: 0.32, valign: "middle", fontSize: 12, bold: true, color: theme.ink, charSpacing: 2, fontFace: theme.fontHead });
  }
  if (brand && !hasBadge) {
    slide.addText(brand, { x: W - M - 4, y: ky + eb.oy, w: 4, h: 0.32, align: "right", valign: "middle", fontSize: 11, bold: true, color: theme.faint, charSpacing: 2.6, fontFace: theme.fontHead });
  }

  // ---- title band
  const bandY = 1.02;
  const hlen = (sl.headline || "").length;
  const twoLine = hlen > 46;
  const headH = twoLine ? 1.02 : 0.62;
  const subH = sl.subhead ? 0.42 : 0;
  const padTop = 0.2;
  const bandH = padTop + headH + subH + 0.18;

  if (banded) {
    slide.addShape("roundRect" as PptxGenJS.ShapeType, {
      x: M + hl.ox, y: bandY + hl.oy, w: CONTENT_W, h: bandH, rectRadius: 0.09,
      fill: { color: bold ? theme.accent : theme.accentSoft },
    });
    if (!bold) slide.addShape("rect" as PptxGenJS.ShapeType, { x: M + hl.ox, y: bandY + hl.oy, w: 0.1, h: bandH, fill: { color: theme.accent } });
    const tx = M + hl.ox + (bold ? 0.34 : 0.4);
    const inkC = bold ? "FFFFFF" : theme.ink;
    slide.addText(runs(sl.headline || " ", { fontSize: 24, bold: true, color: inkC, charSpacing: -0.4, fontFace: theme.fontHead }, theme), {
      x: tx, y: bandY + padTop + hl.oy, w: CONTENT_W - 0.8, h: headH, valign: "top", lineSpacingMultiple: 1.04,
    });
    if (sl.subhead) {
      slide.addText(runs(sl.subhead, { fontSize: 13, color: bold ? "EAF6F1" : theme.muted, fontFace: theme.fontBody }, theme), {
        x: tx, y: bandY + padTop + headH + hl.oy, w: CONTENT_W - 0.8, h: subH, valign: "top",
      });
    }
  } else {
    // editorial: open title, accent left bar + hairline rule
    const barH = twoLine ? 1.0 : 0.6;
    slide.addShape("rect" as PptxGenJS.ShapeType, { x: M + hl.ox, y: bandY + 0.06 + hl.oy, w: 0.08, h: barH, fill: { color: theme.accent } });
    slide.addText(runs(sl.headline || " ", { fontSize: 27, bold: true, color: theme.ink, charSpacing: -0.3, fontFace: theme.fontHead }, theme), {
      x: M + 0.28 + hl.ox, y: bandY + hl.oy, w: CONTENT_W - 0.28, h: headH, valign: "top", lineSpacingMultiple: 1.04,
    });
    if (sl.subhead) {
      slide.addText(runs(sl.subhead, { fontSize: 14, color: theme.muted, fontFace: theme.fontBody }, theme), {
        x: M + 0.28 + hl.ox, y: bandY + headH + hl.oy, w: CONTENT_W - 0.28, h: subH, valign: "top",
      });
    }
    slide.addShape("line" as PptxGenJS.ShapeType, { x: M + hl.ox, y: bandY + bandH + hl.oy, w: CONTENT_W, h: 0, line: { color: theme.line, width: 1 } });
  }

  // ---- footer
  slide.addShape("line" as PptxGenJS.ShapeType, { x: M, y: H - 0.5 + ft.oy, w: CONTENT_W, h: 0, line: { color: theme.line, width: 1 } });
  slide.addText(brand ? `${brand} · ${SECTION_TITLE[sl.sectionKey] ?? ""}` : (SECTION_TITLE[sl.sectionKey] ?? ""), {
    x: M + ft.ox, y: H - 0.45 + ft.oy, w: 7, h: 0.3, fontSize: 9, color: theme.faint, fontFace: theme.fontBody,
  });
  slide.addText(`${pageNo} / ${total}`, {
    x: W - M - 1.5 + ft.ox, y: H - 0.45 + ft.oy, w: 1.5, h: 0.3, fontSize: 9, color: theme.faint, align: "right", fontFace: theme.fontBody,
  });
  return bandY + bandH + 0.42;
}

/* ------------------------------------------------------------------ *
 * building blocks
 * ------------------------------------------------------------------ */
function visualBox(slide: PptxGenJS.Slide, sl: Slide, theme: DeckTheme, t: Labels, x: number, y: number, w: number, h: number) {
  if (sl.visual.kind === "none" && !sl.visual.direction) return;
  const need = sl.visual.needsAsset;
  slide.addShape("roundRect" as PptxGenJS.ShapeType, {
    x, y, w, h, rectRadius: 0.08,
    fill: { color: need ? "FDF3F2" : theme.panel },
    line: { color: need ? "F0B4AD" : theme.line, width: 1, dashType: "dash" },
  });
  slide.addText(
    [
      { text: `▢ ${t.kind[sl.visual.kind] ?? t.kind.none}${need ? t.needAsset : ""}\n`, options: { bold: true, fontSize: 11, color: need ? "B42318" : theme.muted } },
      { text: sl.visual.direction || "—", options: { fontSize: 11, color: theme.ink } },
    ],
    { x: x + 0.2, y: y + 0.2, w: w - 0.4, h: h - 0.4, valign: "top", fontFace: theme.fontBody },
  );
}

/** Bullets as "point cards" — never a naked list. 2 cols when ≥4 and full-width. */
function bulletList(slide: PptxGenJS.Slide, sl: Slide, theme: DeckTheme, x: number, y: number, w: number, h: number, fill = false) {
  const items = sl.bullets;
  if (!items.length) return;
  const n = Math.min(items.length, 6);
  const twoCol = !fill && n >= 4;
  const cols = twoCol ? 2 : 1;
  const rows = Math.ceil(n / cols);
  const gapX = 0.3, gapY = 0.22;
  const cardW = (w - gapX * (cols - 1)) / cols;
  const cardH = Math.min((h - gapY * (rows - 1)) / rows, 1.2);
  const stackH = cardH * rows + gapY * (rows - 1);
  const y0 = y + Math.max(0, (h - stackH) / 2); // center the group vertically
  items.slice(0, n).forEach((b, i) => {
    const r = Math.floor(i / cols), c = i % cols;
    const cx = x + c * (cardW + gapX);
    const cy = y0 + r * (cardH + gapY);
    const em = !!b.emphasis;
    slide.addShape("roundRect" as PptxGenJS.ShapeType, {
      x: cx, y: cy, w: cardW, h: cardH, rectRadius: 0.07,
      fill: { color: em ? theme.accentSoft : theme.panel },
      line: { color: em ? theme.accent : theme.line, width: 1 }, shadow: CARD_SHADOW,
    });
    slide.addShape("rect" as PptxGenJS.ShapeType, { x: cx, y: cy + 0.07, w: 0.09, h: cardH - 0.14, fill: { color: theme.accent } });
    // diamond marker (rotated square)
    slide.addShape("rect" as PptxGenJS.ShapeType, { x: cx + 0.26, y: cy + cardH / 2 - 0.09, w: 0.18, h: 0.18, rotate: 45, fill: { color: theme.accent } });
    slide.addText(runs(b.text, { fontSize: em ? 15.5 : 14.5, bold: em, color: theme.ink, fontFace: theme.fontBody }, theme), {
      x: cx + 0.6, y: cy + 0.1, w: cardW - 0.78, h: cardH - 0.2, valign: "middle", lineSpacingMultiple: 1.06,
    });
  });
}

function metricCards(slide: PptxGenJS.Slide, sl: Slide, theme: DeckTheme, x: number, y: number, w: number, h: number) {
  const n = Math.min(sl.metrics.length, 4);
  if (!n) return;
  const gap = 0.28;
  const cardW = (w - gap * (n - 1)) / n;
  const r = 0.1;
  sl.metrics.slice(0, n).forEach((m, i) => {
    const o = offAt(sl.offsets, `metrics.${i}`);
    const cx = x + i * (cardW + gap) + o.ox;
    const cy = y + o.oy;
    const hero = i === 0; // 첫 카드는 핵심 지표 — 틴트 배경 + 값 액센트 강조
    // elevated card (hero → accent tint)
    slide.addShape("roundRect" as PptxGenJS.ShapeType, { x: cx, y: cy, w: cardW, h, rectRadius: r, fill: { color: hero ? theme.accentSoft : theme.bg }, line: { color: hero ? mixWhite(theme.accent, 0.55) : theme.line, width: 1 }, shadow: CARD_SHADOW });
    // top accent bar (inset by corner radius so it sits on the flat top edge)
    slide.addShape("rect" as PptxGenJS.ShapeType, { x: cx + r, y: cy, w: cardW - r * 2, h: 0.08, fill: { color: theme.accent } });
    // big number
    slide.addText(runs(m.value, { fontSize: 46, bold: true, color: hero ? theme.accent : theme.ink, align: "left", charSpacing: -0.9, fontFace: theme.fontHead }, theme), {
      x: cx + 0.3, y: cy + 0.36, w: cardW - 0.5, h: 1.0, valign: "top",
    });
    slide.addText(m.label, { x: cx + 0.3, y: cy + h - (m.sub ? 1.02 : 0.72), w: cardW - 0.5, h: 0.5, fontSize: 13, bold: true, color: theme.ink, valign: "top", fontFace: theme.fontBody });
    if (m.sub) slide.addText(m.sub, { x: cx + 0.3, y: cy + h - 0.52, w: cardW - 0.5, h: 0.35, fontSize: 10.5, color: theme.accent2, valign: "top", fontFace: theme.fontBody });
  });
}

function compareColumns(slide: PptxGenJS.Slide, sl: Slide, theme: DeckTheme, x: number, y: number, w: number, h: number) {
  const n = Math.min(sl.columns.length, 3);
  if (!n) return;
  const gap = 0.3;
  const colW = (w - gap * (n - 1)) / n;
  const stripH = 0.62;
  sl.columns.slice(0, n).forEach((c, i) => {
    const o = offAt(sl.offsets, `columns.${i}`);
    const cx = x + i * (colW + gap) + o.ox;
    const cy = y + o.oy;
    const accent = !!c.accent;
    // card shell (white body, accent/line border)
    slide.addShape("roundRect" as PptxGenJS.ShapeType, {
      x: cx, y: cy, w: colW, h, rectRadius: 0.1,
      fill: { color: theme.bg }, line: { color: accent ? theme.accent : theme.line, width: 1.5 }, shadow: CARD_SHADOW,
    });
    // header strip (accent fill for the recommended column, panel otherwise).
    // roundRect (same radius as the card) so its top corners hug the card edge.
    slide.addShape("roundRect" as PptxGenJS.ShapeType, { x: cx, y: cy, w: colW, h: stripH, rectRadius: 0.1, fill: { color: accent ? theme.accent : theme.panel } });
    // square off the strip's bottom corners against the body
    slide.addShape("rect" as PptxGenJS.ShapeType, { x: cx, y: cy + stripH - 0.12, w: colW, h: 0.12, fill: { color: accent ? theme.accent : theme.panel } });
    slide.addText(c.heading, {
      x: cx + 0.26, y: cy + 0.02, w: colW - (accent ? 1.4 : 0.5), h: stripH, valign: "middle", fontSize: 16, bold: true,
      color: accent ? "FFFFFF" : theme.ink, charSpacing: -0.2, fontFace: theme.fontHead,
    });
    if (accent) {
      slide.addShape("roundRect" as PptxGenJS.ShapeType, { x: cx + colW - 1.05, y: cy + 0.15, w: 0.8, h: 0.34, rectRadius: 0.17, fill: { color: "FFFFFF" } });
      slide.addText("추천", { x: cx + colW - 1.05, y: cy + 0.15, w: 0.8, h: 0.34, align: "center", valign: "middle", fontSize: 10, bold: true, color: theme.accent, charSpacing: 1, fontFace: theme.fontHead });
    }
    const items: Run[] = c.items.flatMap((it) =>
      runs(it, {
        fontSize: 13, color: theme.ink,
        bullet: { characterCode: accent ? "2713" : "2022", indent: 16 }, paraSpaceAfter: 9, fontFace: theme.fontBody,
      }, theme),
    );
    slide.addText(items, { x: cx + 0.28, y: cy + stripH + 0.24, w: colW - 0.56, h: h - stripH - 0.4, valign: "top" });
  });
}

function processSteps(slide: PptxGenJS.Slide, sl: Slide, theme: DeckTheme, x: number, y: number, w: number, h: number) {
  const n = Math.min(sl.steps.length, 5);
  if (!n) return;
  const gap = 0.34;
  const stepW = (w - gap * (n - 1)) / n;
  // connector line behind the cards
  slide.addShape("line" as PptxGenJS.ShapeType, { x: x + 0.5, y: y + 0.5, w: w - 1.0, h: 0, line: { color: theme.line, width: 1.5 } });
  sl.steps.slice(0, n).forEach((s, i) => {
    const o = offAt(sl.offsets, `steps.${i}`);
    const sx = x + i * (stepW + gap) + o.ox;
    const sy = y + o.oy;
    slide.addShape("roundRect" as PptxGenJS.ShapeType, { x: sx, y: sy, w: stepW, h, rectRadius: 0.1, fill: { color: theme.bg }, line: { color: theme.line, width: 1 }, shadow: CARD_SHADOW });
    slide.addShape("ellipse" as PptxGenJS.ShapeType, { x: sx + 0.28, y: sy + 0.28, w: 0.56, h: 0.56, fill: { color: theme.accent } });
    slide.addText(String(i + 1), { x: sx + 0.28, y: sy + 0.28, w: 0.56, h: 0.56, align: "center", valign: "middle", fontSize: 18, bold: true, color: theme.onAccent, fontFace: theme.fontHead });
    slide.addText(s.title, { x: sx + 0.28, y: sy + 1.0, w: stepW - 0.56, h: 0.6, fontSize: 14.5, bold: true, color: theme.ink, valign: "top", fontFace: theme.fontHead });
    if (s.detail) slide.addText(s.detail, { x: sx + 0.28, y: sy + 1.58, w: stepW - 0.56, h: h - 1.78, fontSize: 11, color: theme.muted, valign: "top", fontFace: theme.fontBody });
  });
}

function teamGrid(slide: PptxGenJS.Slide, sl: Slide, theme: DeckTheme, t: Labels, x: number, y: number, w: number, h: number) {
  const n = Math.min(sl.team.length, 4);
  if (!n) return;
  const gap = 0.25;
  const cardW = (w - gap * (n - 1)) / n;
  sl.team.slice(0, n).forEach((m, i) => {
    const o = offAt(sl.offsets, `team.${i}`);
    const cx = x + i * (cardW + gap) + o.ox;
    const cy = y + o.oy;
    slide.addShape("roundRect" as PptxGenJS.ShapeType, { x: cx, y: cy, w: cardW, h, rectRadius: 0.1, fill: { color: theme.bg }, line: { color: theme.line, width: 1 }, shadow: CARD_SHADOW });
    // monogram with accent ring
    slide.addShape("ellipse" as PptxGenJS.ShapeType, { x: cx + cardW / 2 - 0.56, y: cy + 0.28, w: 1.12, h: 1.12, fill: { color: theme.bg }, line: { color: theme.accent, width: 2 } });
    slide.addShape("ellipse" as PptxGenJS.ShapeType, { x: cx + cardW / 2 - 0.5, y: cy + 0.34, w: 1.0, h: 1.0, fill: { color: theme.accentSoft } });
    slide.addText(monogram(m.name), { x: cx + cardW / 2 - 0.5, y: cy + 0.34, w: 1.0, h: 1.0, align: "center", valign: "middle", fontSize: 30, bold: true, color: theme.accent, fontFace: theme.fontHead });
    slide.addText(m.name, { x: cx + 0.1, y: cy + 1.5, w: cardW - 0.2, h: 0.35, align: "center", fontSize: 14, bold: true, color: theme.ink, fontFace: theme.fontHead });
    slide.addText(`${m.role ?? ""}${m.fullTime === false ? t.partTime : m.fullTime ? t.fullTime : ""}`, { x: cx + 0.1, y: cy + 1.85, w: cardW - 0.2, h: 0.3, align: "center", fontSize: 11, bold: true, color: theme.accent, fontFace: theme.fontBody });
    if (m.note) slide.addText(m.note, { x: cx + 0.15, y: cy + 2.2, w: cardW - 0.3, h: h - 2.35, align: "center", fontSize: 10, color: theme.muted, valign: "top", fontFace: theme.fontBody });
  });
}

const CHART_TYPE: Record<ChartSpec["type"], PptxGenJS.CHART_NAME> = {
  bar: "bar" as PptxGenJS.CHART_NAME,
  line: "line" as PptxGenJS.CHART_NAME,
  area: "area" as PptxGenJS.CHART_NAME,
  pie: "pie" as PptxGenJS.CHART_NAME,
};

function chartBox(slide: PptxGenJS.Slide, pptx: PptxGenJS, chart: ChartSpec, theme: DeckTheme, t: Labels, x: number, y: number, w: number, h: number) {
  const hasData = chart.series.length > 0 && chart.series.some((s) => s.values.length > 0);
  if (chart.title) {
    slide.addText(chart.title, { x, y, w, h: 0.35, fontSize: 13, bold: true, color: theme.ink, fontFace: theme.fontHead });
    y += 0.45; h -= 0.45;
  }
  if (!hasData) {
    slide.addShape("roundRect" as PptxGenJS.ShapeType, { x, y, w, h, rectRadius: 0.08, fill: { color: theme.panel }, line: { color: theme.line, width: 1, dashType: "dash" } });
    slide.addText(
      [
        { text: `${t.chartTitle}\n`, options: { bold: true, fontSize: 12, color: "B42318" } },
        { text: chart.categories.length ? `${chart.categories.join(" · ")}` : t.chartHint, options: { fontSize: 11, color: theme.muted } },
      ],
      { x: x + 0.2, y: y + 0.2, w: w - 0.4, h: h - 0.4, valign: "middle", align: "center", fontFace: theme.fontBody },
    );
    return;
  }
  const data =
    chart.type === "pie"
      ? [{ name: chart.title || "", labels: chart.categories, values: chart.series[0]!.values }]
      : chart.series.map((s) => ({ name: s.name, labels: chart.categories, values: s.values }));
  // single-series bar → color every bar accent, emphasize the last (latest / target) in accent2
  const single = chart.type === "bar" && chart.series.length === 1;
  const cats = chart.categories.length ? chart.categories : (chart.series[0]?.values ?? []);
  const chartColors = single
    ? cats.map((_, i) => (i === cats.length - 1 ? theme.accent2 : theme.accent))
    : seriesColors(theme);
  slide.addChart(CHART_TYPE[chart.type], data, {
    x, y, w, h,
    chartColors,
    showLegend: chart.series.length > 1 || chart.type === "pie",
    legendPos: "b",
    showValue: chart.type !== "line",
    catAxisLabelColor: theme.muted,
    valAxisLabelColor: theme.muted,
    dataLabelColor: theme.ink,
    fontSize: 10,
  } as PptxGenJS.IChartOpts);
  if (!chart.confirmed) {
    slide.addText(t.confirm, { x: x + w - 1.6, y, w: 1.6, h: 0.3, align: "right", fontSize: 9, italic: true, color: "B42318", fontFace: theme.fontBody });
  }
}

/** Chart framed in a soft panel (matches SlideCanvas). No-data falls through to
 * chartBox's own dashed placeholder so we don't double-box it. */
function chartPanel(slide: PptxGenJS.Slide, pptx: PptxGenJS, chart: ChartSpec, theme: DeckTheme, t: Labels, x: number, y: number, w: number, h: number) {
  const hasData = chart.series.length > 0 && chart.series.some((s) => s.values.length > 0);
  if (hasData) {
    slide.addShape("roundRect" as PptxGenJS.ShapeType, { x, y, w, h, rectRadius: 0.09, fill: { color: theme.panel }, line: { color: theme.line, width: 1 } });
    chartBox(slide, pptx, chart, theme, t, x + 0.26, y + 0.22, w - 0.52, h - 0.44);
  } else {
    chartBox(slide, pptx, chart, theme, t, x, y, w, h);
  }
}

/* ------------------------------------------------------------------ *
 * per-layout renderers
 * ------------------------------------------------------------------ */
function renderCover(slide: PptxGenJS.Slide, sl: Slide, theme: DeckTheme) {
  const eb = offAt(sl.offsets, "eyebrow"), hl = offAt(sl.offsets, "headline"), sh = offAt(sl.offsets, "subhead"), bl = offAt(sl.offsets, "bullets");
  const st = theme.style.cover;
  if (st === "band") {
    // bold: full accent background, white type + faint geometric shapes
    slide.background = { color: theme.accent };
    slide.addShape("ellipse" as PptxGenJS.ShapeType, { x: W - 4.2, y: -2.2, w: 6.5, h: 6.5, fill: { color: "FFFFFF", transparency: 90 } });
    slide.addShape("roundRect" as PptxGenJS.ShapeType, { x: W - 3.0, y: H - 3.2, w: 4.4, h: 4.4, rectRadius: 0.5, rotate: 14, fill: { color: theme.ink, transparency: 84 } });
    slide.addShape("rect" as PptxGenJS.ShapeType, { x: 0, y: H - 0.28, w: W, h: 0.28, fill: { color: theme.ink } });
    if (sl.eyebrow) slide.addText(sl.eyebrow.toUpperCase(), { x: M + eb.ox, y: 2.3 + eb.oy, w: CONTENT_W, h: 0.4, fontSize: 14, bold: true, color: "FFFFFF", charSpacing: 3, fontFace: theme.fontHead });
    slide.addText(sl.headline || "", { x: M + hl.ox, y: 2.78 + hl.oy, w: CONTENT_W * 0.82, h: 1.9, fontSize: 52, bold: true, color: "FFFFFF", charSpacing: -0.6, valign: "top", lineSpacingMultiple: 1.02, fontFace: theme.fontHead });
    if (sl.subhead) slide.addText(sl.subhead, { x: M + sh.ox, y: 4.85 + sh.oy, w: CONTENT_W * 0.78, h: 0.9, fontSize: 20, color: "F3FBF8", valign: "top", fontFace: theme.fontBody });
    if (sl.bullets.length) slide.addText(sl.bullets.map((b) => b.text).join("   ·   "), { x: M + bl.ox, y: 5.85 + bl.oy, w: CONTENT_W, h: 0.5, fontSize: 14, color: "DFF4EC", fontFace: theme.fontBody });
    return;
  }
  if (st === "light") {
    // editorial: paper background, ink serif type, left accent rule + faint accent block
    slide.background = { color: theme.bg };
    slide.addShape("roundRect" as PptxGenJS.ShapeType, { x: W - 3.4, y: -1.8, w: 5.2, h: 5.2, rectRadius: 0.5, rotate: 12, fill: { color: theme.accent, transparency: 90 } });
    slide.addShape("rect" as PptxGenJS.ShapeType, { x: M, y: 2.55, w: 0.08, h: 2.7, fill: { color: theme.accent } });
    if (sl.eyebrow) slide.addText(sl.eyebrow.toUpperCase(), { x: M + 0.35 + eb.ox, y: 2.5 + eb.oy, w: CONTENT_W, h: 0.4, fontSize: 14, bold: true, color: theme.accent, charSpacing: 3, fontFace: theme.fontHead });
    slide.addText(sl.headline || "", { x: M + 0.35 + hl.ox, y: 2.95 + hl.oy, w: CONTENT_W - 0.35, h: 1.9, fontSize: 50, bold: true, color: theme.ink, charSpacing: -0.4, valign: "top", lineSpacingMultiple: 1.02, fontFace: theme.fontHead });
    if (sl.subhead) slide.addText(sl.subhead, { x: M + 0.35 + sh.ox, y: 4.95 + sh.oy, w: CONTENT_W - 0.35, h: 0.9, fontSize: 19, color: theme.muted, valign: "top", fontFace: theme.fontBody });
    if (sl.bullets.length) slide.addText(sl.bullets.map((b) => b.text).join("   ·   "), { x: M + 0.35 + bl.ox, y: 5.9 + bl.oy, w: CONTENT_W - 0.35, h: 0.5, fontSize: 14, color: theme.faint, fontFace: theme.fontBody });
    return;
  }
  // minimal: dark cover + geometric accents (rotated tinted block + accent2 circle)
  slide.background = { color: theme.ink };
  slide.addShape("roundRect" as PptxGenJS.ShapeType, { x: W - 3.6, y: -2.4, w: 6.2, h: 6.2, rectRadius: 0.6, rotate: 12, fill: { color: theme.accent, transparency: 82 } });
  slide.addShape("ellipse" as PptxGenJS.ShapeType, { x: W - 3.4, y: H - 2.6, w: 4.6, h: 4.6, fill: { color: theme.accent2, transparency: 86 } });
  slide.addShape("rect" as PptxGenJS.ShapeType, { x: 0, y: H - 0.24, w: W, h: 0.24, fill: { color: theme.accent } });
  if (sl.eyebrow) slide.addText(sl.eyebrow.toUpperCase(), { x: M + eb.ox, y: 2.3 + eb.oy, w: CONTENT_W, h: 0.4, fontSize: 14, bold: true, color: theme.accent2, charSpacing: 3, fontFace: theme.fontHead });
  slide.addText(sl.headline || "", { x: M + hl.ox, y: 2.78 + hl.oy, w: CONTENT_W * 0.82, h: 1.9, fontSize: 52, bold: true, color: "FFFFFF", charSpacing: -0.6, valign: "top", lineSpacingMultiple: 1.02, fontFace: theme.fontHead });
  if (sl.subhead) slide.addText(sl.subhead, { x: M + sh.ox, y: 4.85 + sh.oy, w: CONTENT_W * 0.78, h: 0.9, fontSize: 20, color: "C9D2E3", valign: "top", fontFace: theme.fontBody });
  if (sl.bullets.length) slide.addText(sl.bullets.map((b) => b.text).join("   ·   "), { x: M + bl.ox, y: 5.85 + bl.oy, w: CONTENT_W, h: 0.5, fontSize: 14, color: "94A0B3", fontFace: theme.fontBody });
}

function renderStatement(slide: PptxGenJS.Slide, sl: Slide, theme: DeckTheme) {
  const eb = offAt(sl.offsets, "eyebrow"), hl = offAt(sl.offsets, "headline"), sh = offAt(sl.offsets, "subhead");
  // dramatic dark canvas with faint geometric accents (matches SlideCanvas)
  slide.background = { color: theme.ink };
  slide.addShape("ellipse" as PptxGenJS.ShapeType, { x: -1.3, y: -1.3, w: 4.6, h: 4.6, fill: { color: theme.accent, transparency: 84 } });
  slide.addShape("roundRect" as PptxGenJS.ShapeType, { x: W - 3.0, y: H - 3.0, w: 4.0, h: 4.0, rectRadius: 0.5, rotate: 12, fill: { color: theme.accent2, transparency: 86 } });
  if (sl.eyebrow) slide.addText(sl.eyebrow.toUpperCase(), { x: 1.5 + eb.ox, y: 2.25 + eb.oy, w: W - 3, h: 0.4, align: "center", fontSize: 13, bold: true, color: theme.accent2, charSpacing: 3, fontFace: theme.fontHead });
  slide.addText(runs(sl.headline || "", { fontSize: 40, bold: true, color: "FFFFFF", align: "center", fontFace: theme.fontHead }, theme), {
    x: 1.0 + hl.ox, y: 2.75 + hl.oy, w: W - 2, h: 1.8, valign: "middle", align: "center", lineSpacingMultiple: 1.08,
  });
  if (sl.subhead) slide.addText(sl.subhead, { x: 1.5 + sh.ox, y: 4.75 + sh.oy, w: W - 3, h: 0.7, align: "center", fontSize: 18, color: "C9D2E3", fontFace: theme.fontBody });
}

function renderBody(slide: PptxGenJS.Slide, pptx: PptxGenJS, sl: Slide, theme: DeckTheme, t: Labels, top: number) {
  const bottom = H - 0.7;
  const h = bottom - top;
  const hasVisual = sl.visual.kind !== "none" || !!sl.visual.direction;

  // per-block position nudges (default {0,0})
  const oMet = offIn(sl.offsets?.metrics);
  const oBul = offIn(sl.offsets?.bullets);
  const oCht = offIn(sl.offsets?.chart);
  const oVis = offIn(sl.offsets?.visual);
  const oCol = offIn(sl.offsets?.columns);
  const oStp = offIn(sl.offsets?.steps);
  const oTem = offIn(sl.offsets?.team);

  switch (sl.layout) {
    case "metrics": {
      const cardsH = 2.05;
      metricCards(slide, sl, theme, M + oMet.ox, top + oMet.oy, CONTENT_W, cardsH);
      if (sl.chart) chartBox(slide, pptx, sl.chart, theme, t, M + oCht.ox, top + cardsH + 0.35 + oCht.oy, CONTENT_W, h - cardsH - 0.35);
      else if (sl.bullets.length) bulletList(slide, sl, theme, M + oBul.ox, top + cardsH + 0.35 + oBul.oy, CONTENT_W, h - cardsH - 0.35);
      break;
    }
    case "comparison":
      compareColumns(slide, sl, theme, M + oCol.ox, top + oCol.oy, CONTENT_W, h);
      break;
    case "process":
      processSteps(slide, sl, theme, M + oStp.ox, top + oStp.oy, CONTENT_W, Math.min(h, 3.2));
      break;
    case "team":
      teamGrid(slide, sl, theme, t, M + oTem.ox, top + oTem.oy, CONTENT_W, Math.min(h, 3.6));
      break;
    case "chart":
      if (sl.chart) {
        if (sl.bullets.length) {
          chartPanel(slide, pptx, sl.chart, theme, t, M + oCht.ox, top + oCht.oy, CONTENT_W * 0.6, h);
          bulletList(slide, sl, theme, M + CONTENT_W * 0.63 + oBul.ox, top + oBul.oy, CONTENT_W * 0.37, h, true);
        } else {
          chartPanel(slide, pptx, sl.chart, theme, t, M + oCht.ox, top + oCht.oy, CONTENT_W, h);
        }
      } else {
        bulletList(slide, sl, theme, M + oBul.ox, top + oBul.oy, CONTENT_W, h);
      }
      break;
    case "bullets":
    default:
      if (hasVisual) {
        bulletList(slide, sl, theme, M + oBul.ox, top + oBul.oy, CONTENT_W * 0.56, h, true);
        visualBox(slide, sl, theme, t, M + CONTENT_W * 0.61 + oVis.ox, top + oVis.oy, CONTENT_W * 0.39, Math.min(h, 3.6));
      } else if (sl.chart) {
        bulletList(slide, sl, theme, M + oBul.ox, top + oBul.oy, CONTENT_W * 0.5, h, true);
        chartPanel(slide, pptx, sl.chart, theme, t, M + CONTENT_W * 0.55 + oCht.ox, top + oCht.oy, CONTENT_W * 0.45, h);
      } else {
        bulletList(slide, sl, theme, M + oBul.ox, top + oBul.oy, CONTENT_W, h);
      }
      break;
  }
}

function renderClosing(slide: PptxGenJS.Slide, sl: Slide, theme: DeckTheme) {
  const eb = offAt(sl.offsets, "eyebrow"), hl = offAt(sl.offsets, "headline"), bl = offAt(sl.offsets, "bullets"), vs = offAt(sl.offsets, "visual");
  const light = theme.style.cover === "light";
  const ink = light ? theme.ink : "FFFFFF";
  const sub = light ? theme.muted : "E4E8F0";
  slide.background = { color: light ? theme.bg : theme.ink };
  slide.addShape("rect" as PptxGenJS.ShapeType, { x: 0, y: 0, w: 0.35, h: H, fill: { color: theme.accent } });
  if (sl.eyebrow) slide.addText(sl.eyebrow.toUpperCase(), { x: 1.2 + eb.ox, y: 1.6 + eb.oy, w: W - 2.4, h: 0.4, fontSize: 14, bold: true, color: light ? theme.accent : theme.accent2, charSpacing: 3, fontFace: theme.fontHead });
  slide.addText(sl.headline || "", { x: 1.2 + hl.ox, y: 2.1 + hl.oy, w: W - 2.4, h: 1.2, fontSize: 38, bold: true, color: ink, valign: "top", fontFace: theme.fontHead });
  if (sl.bullets.length) {
    slide.addText(
      sl.bullets.flatMap((b) => runs(b.text, { fontSize: 18, color: sub, bullet: { indent: 18 }, paraSpaceAfter: 10, fontFace: theme.fontBody }, theme)),
      { x: 1.2 + bl.ox, y: 3.5 + bl.oy, w: (W - 2.4) * 0.6, h: 2.6, valign: "top" },
    );
  }
  if (sl.visual.direction || sl.visual.kind === "logo") {
    slide.addShape("roundRect" as PptxGenJS.ShapeType, { x: W - 4.6 + vs.ox, y: 3.6 + vs.oy, w: 3.4, h: 2.2, rectRadius: 0.08, fill: { color: light ? theme.panel : "222C44" }, line: { color: theme.accent, width: 1, dashType: "dash" } });
    slide.addText(sl.visual.direction || "로고 · 연락처", { x: W - 4.4 + vs.ox, y: 3.8 + vs.oy, w: 3.0, h: 1.8, fontSize: 12, color: sub, valign: "top", fontFace: theme.fontBody });
  }
}

/* ------------------------------------------------------------------ */
const STATUS_PPT: Record<string, { label: string; bg: string }> = {
  missing: { label: "MISSING", bg: "B42318" },
  needs_input: { label: "NEEDS INPUT", bg: "B9820B" },
  recommend: { label: "RECOMMEND", bg: "2E5AAC" },
  ok: { label: "OK", bg: "0E7C5A" },
};

function renderSlide(pptx: PptxGenJS, sl: Slide, theme: DeckTheme, t: Labels, lang: Lang, brand: string, pageNo: number, total: number): void {
  const slide = pptx.addSlide();
  slide.background = { color: theme.bg };
  const fullBleed = ["cover", "statement", "closing"].includes(sl.layout);
  const status = sl.status ?? "ok";
  const hasBadge = status !== "ok";

  if (sl.layout === "cover") renderCover(slide, sl, theme);
  else if (sl.layout === "statement") renderStatement(slide, sl, theme);
  else if (sl.layout === "closing") renderClosing(slide, sl, theme);
  else {
    const top = chrome(slide, sl, theme, brand, pageNo, total, hasBadge);
    renderBody(slide, pptx, sl, theme, t, top);
  }

  // consulting status badge (top-right) — subtle hand-off marker (dot + label)
  if (hasBadge) {
    const meta = STATUS_PPT[status]!;
    const bo = offAt(sl.offsets, "badge");
    slide.addShape("roundRect" as PptxGenJS.ShapeType, { x: W - 2.1 + bo.ox, y: 0.28 + bo.oy, w: 1.8, h: 0.34, rectRadius: 0.17, fill: { color: "FFFFFF" }, line: { color: meta.bg, width: 1 } });
    slide.addShape("ellipse" as PptxGenJS.ShapeType, { x: W - 1.95 + bo.ox, y: 0.4 + bo.oy, w: 0.11, h: 0.11, fill: { color: meta.bg } });
    slide.addText(meta.label, { x: W - 1.78 + bo.ox, y: 0.28 + bo.oy, w: 1.45, h: 0.34, align: "left", valign: "middle", fontSize: 9, bold: true, color: meta.bg, charSpacing: 1, fontFace: theme.fontHead });
  }

  // "채워오기" — missing checklist items on one compact line (non-full-bleed)
  const missing = (sl.checklist ?? []).filter((c) => !c.done).map((c) => c.label);
  if (!fullBleed && missing.length) {
    slide.addText(
      [
        { text: lang === "en" ? "❗ To add: " : "❗ 채워오기: ", options: { bold: true, fontSize: 9, color: "B42318" } },
        { text: missing.join("  ·  "), options: { fontSize: 9, color: "B42318" } },
      ],
      { x: M, y: H - 0.9, w: CONTENT_W, h: 0.3, valign: "middle" },
    );
  } else if (!fullBleed && sl.memo) {
    slide.addText(
      [
        { text: `${t.memo}  `, options: { bold: true, fontSize: 9, color: theme.faint } },
        ...runs(sl.memo, { fontSize: 9, color: theme.muted, fontFace: theme.fontBody }, theme),
      ],
      { x: M, y: H - 0.9, w: CONTENT_W, h: 0.3, valign: "middle" },
    );
  }

  const checklistNote = (sl.checklist ?? []).length
    ? "\n\n[SparkLabs 체크리스트]\n" + sl.checklist.map((c) => `${c.done ? "☑" : "☐"} ${c.label}${c.note ? ` — ${c.note}` : ""}`).join("\n")
    : "";
  const recNote = sl.gapNote ? `\n\n[보완 방향] ${sl.gapNote}` : "";
  const flagNote = sl.flags.length ? "\n\n[unresolved]\n" + sl.flags.map((f) => `- [${f.kind}] ${f.message}`).join("\n") : "";
  slide.addNotes((sl.speakerNotes || "") + checklistNote + recNote + flagNote);
}

export async function writeSkeletonPptx(doc: SkeletonDoc, outPath: string, lang: Lang = "ko", styleId?: string): Promise<string> {
  const theme = resolveTheme(doc.accentColor, styleId ?? doc.variant) ?? DEFAULT_THEME;
  const t = labels(lang);
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "WIDE16x9", width: W, height: H });
  pptx.layout = "WIDE16x9";
  pptx.author = "AI Deck Consulting Agent";
  pptx.title = `${doc.companyName} deck`;
  const total = doc.slides.length;
  const brand = brandMark(doc.companyName);
  doc.slides.forEach((sl, i) => renderSlide(pptx, sl, theme, t, lang, brand, i + 1, total));
  await pptx.writeFile({ fileName: outPath });
  return outPath;
}
