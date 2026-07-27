/**
 * Shared deck theme + geometry.
 *
 * BOTH the browser preview (app/slide/SlideCanvas.tsx) and the pptx exporter
 * (src/render/pptx.ts) render from this single source, so the on-screen slide
 * matches the downloaded file. Colors are hex WITHOUT the leading "#" so they
 * can be handed straight to pptxgenjs; the HTML side prefixes "#".
 */

export interface DeckTheme {
  /** primary text */
  ink: string;
  /** secondary text */
  muted: string;
  /** faint captions / eyebrow */
  faint: string;
  /** brand accent */
  accent: string;
  /** secondary accent (charts, second series) */
  accent2: string;
  /** very light accent tint (card headers, monograms, chips) */
  accentSoft: string;
  /** slide background */
  bg: string;
  /** panel / card background */
  panel: string;
  /** subtle panel border */
  line: string;
  /** ink used on top of the accent (e.g. accent header band) */
  onAccent: string;
  fontHead: string;
  fontBody: string;
  /** the design variant this theme was built from (drives renderer branching) */
  style: DeckStyle;
}

/* ============================================================
 * Design variants — the "여러 버전" the user picks between.
 *
 * One skeleton (content) renders into N visually distinct decks. A variant is
 * a small preset of structural style knobs; BOTH renderers (pptx + SlideCanvas)
 * branch on `theme.style` so preview == export for every variant.
 * ============================================================ */

export type StyleId = "minimal" | "bold" | "editorial";

export interface DeckStyle {
  id: StyleId;
  /** short Korean label for the picker card */
  label: string;
  /** one-line description for the picker card */
  blurb: string;
  /** default accent palette key for this variant */
  accentKey: string;
  /** cover / closing full-bleed treatment */
  cover: "dark" | "band" | "light";
  /** card / panel treatment: soft gray, outline-only, or accent tint */
  panel: "soft" | "outline" | "tint";
  /** show the accent rule under the headline */
  rule: boolean;
  /** serif headline face (editorial look) */
  serifHead: boolean;
}

export const DECK_STYLES: DeckStyle[] = [
  { id: "minimal", label: "미니멀", blurb: "화이트·여백 중심 · 인디고 포인트", accentKey: "indigo", cover: "dark", panel: "soft", rule: true, serifHead: false },
  { id: "bold", label: "볼드", blurb: "고대비·꽉 찬 컬러 · 에메랄드", accentKey: "emerald", cover: "band", panel: "tint", rule: true, serifHead: false },
  { id: "editorial", label: "에디토리얼", blurb: "명조 헤드라인·라인 강조 · 슬레이트", accentKey: "slate", cover: "light", panel: "outline", rule: false, serifHead: true },
];

export function styleById(id?: string): DeckStyle {
  return DECK_STYLES.find((s) => s.id === id) ?? DECK_STYLES[0]!;
}

/** A small palette of pleasant accents the generator may pick from. */
export const ACCENT_PALETTE: Record<string, { accent: string; accent2: string }> = {
  indigo: { accent: "3D5AFE", accent2: "00BFA5" },
  blue: { accent: "1E88E5", accent2: "26C6DA" },
  violet: { accent: "6C4BF6", accent2: "F06292" },
  teal: { accent: "0E9F8E", accent2: "3D5AFE" },
  emerald: { accent: "10B981", accent2: "3B82F6" },
  amber: { accent: "F59E0B", accent2: "3D5AFE" },
  rose: { accent: "F43F5E", accent2: "6366F1" },
  slate: { accent: "334155", accent2: "0EA5E9" },
};

/** short uppercase brand wordmark from a company name (prefers an ASCII token). */
export function brandMark(name?: string): string {
  if (!name) return "";
  const ascii = name.match(/[A-Za-z][A-Za-z0-9&.\- ]{1,}/g);
  const pick = (ascii && [...ascii].sort((a, b) => b.length - a.length)[0]) || name.split(/[\s(（]/)[0] || name;
  return pick.trim().toUpperCase().slice(0, 18);
}

/** Mix a hex color toward white by `amt` (0..1). amt=1 → white. */
export function mixWhite(hex: string, amt: number): string {
  const h = hex.replace(/^#/, "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const m = (v: number) => Math.round(v + (255 - v) * amt);
  return [m(r), m(g), m(b)].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
}

const SERIF_HEAD = "바탕";
const SANS = "맑은 고딕";

/** Base (minimal-variant, indigo) theme — the safe fallback. */
export const DEFAULT_THEME: DeckTheme = buildTheme(styleById("minimal"));

function buildTheme(style: DeckStyle, accent?: string, accent2?: string): DeckTheme {
  const pal = ACCENT_PALETTE[style.accentKey] ?? ACCENT_PALETTE.indigo!;
  const a = accent ?? pal.accent;
  const a2 = accent2 ?? pal.accent2;
  const base = {
    accent: a,
    accent2: a2,
    accentSoft: mixWhite(a, style.panel === "tint" ? 0.84 : 0.9),
    onAccent: "FFFFFF",
    fontHead: style.serifHead ? SERIF_HEAD : SANS,
    fontBody: SANS,
    style,
  };
  if (style.panel === "tint") {
    // bold: cards get a light accent tint; stronger lines
    return { ink: "141C2E", muted: "55607A", faint: "9AA3B5", bg: "FFFFFF", panel: mixWhite(a, 0.9), line: mixWhite(a, 0.72), ...base };
  }
  if (style.panel === "outline") {
    // editorial: warm paper, outline cards, warm gray lines
    return { ink: "23262B", muted: "5C606B", faint: "9A9E9A", bg: "FBFBF8", panel: "FFFFFF", line: "DAD9D2", ...base };
  }
  // minimal (soft): cool gray panels
  return { ink: "17223B", muted: "5B6472", faint: "94A0B3", bg: "FFFFFF", panel: "F3F5FA", line: "E4E8F0", ...base };
}

/**
 * Resolve a theme for a given design variant, applying an optional accent
 * override (palette key or hex) from the model / a user edit.
 */
export function resolveTheme(accentColor?: string, styleId?: string): DeckTheme {
  const style = styleById(styleId);
  if (!accentColor) return buildTheme(style);
  const key = accentColor.trim().toLowerCase();
  if (ACCENT_PALETTE[key]) return buildTheme(style, ACCENT_PALETTE[key]!.accent, ACCENT_PALETTE[key]!.accent2);
  const hex = key.replace(/^#/, "");
  if (/^[0-9a-f]{6}$/i.test(hex)) return buildTheme(style, hex.toUpperCase());
  return buildTheme(style);
}

/**
 * Slide geometry — standard 16:9 widescreen (inches), matching pptxgenjs WIDE.
 * The HTML canvas maps these inch coordinates to % of a 13.333×7.5 box, so both
 * renderers share the same layout math.
 */
export const GEOM = {
  W: 13.333,
  H: 7.5,
  margin: 0.62,
  headerY: 0.62,
  headlineY: 1.15,
  bodyY: 2.35,
  footerY: 7.0,
} as const;

/** Chart series colors, in order. */
export function seriesColors(theme: DeckTheme): string[] {
  return [theme.accent, theme.accent2, "F59E0B", "F43F5E", "8B5CF6", "94A0B3"];
}

/**
 * Soft card elevation — the single biggest "premium" lever.
 * pptx side is a pptxgenjs ShadowProps; HTML side is a CSS box-shadow string
 * (in cqw so it scales with the slide). Kept here so preview == export.
 */
export const PPTX_CARD_SHADOW = { type: "outer", color: "8A94AC", blur: 7, offset: 3, angle: 90, opacity: 0.22 } as const;
export const CSS_CARD_SHADOW = "0 0.15cqw 0.85cqw rgba(20,26,46,0.10), 0 0.04cqw 0.25cqw rgba(20,26,46,0.07)";
