"use client";

/**
 * VariantPicker — the "여러 버전" chooser. One skeleton, N design variants.
 * Each card renders a representative slide through that variant's theme, so the
 * choice is a real preview. Selecting drives the live preview + the pptx
 * download (?variant=) — no LLM re-generation, so it's instant.
 */

import SlideCanvas from "./SlideCanvas";
import { DECK_STYLES, brandMark } from "@engine/domain/deckTheme.js";
import { sectionTitleOf } from "./sections";
import type { SkeletonDoc, Slide } from "../types";

function pickPreviewSlide(sk: SkeletonDoc): Slide | undefined {
  const pref = sk.slides.find((s) => ["metrics", "bullets", "chart", "comparison"].includes(s.layout));
  return pref ?? sk.slides.find((s) => s.layout !== "cover") ?? sk.slides[0];
}

export default function VariantPicker({
  skeleton,
  value,
  onChange,
}: {
  skeleton: SkeletonDoc;
  value: string;
  onChange: (id: string) => void;
}) {
  const slide = pickPreviewSlide(skeleton);
  if (!slide) return null;
  return (
    <div className="variant-picker">
      <div className="vp-head">
        디자인 버전 <span className="muted">— 클릭해 선택하면 미리보기·다운로드에 바로 반영됩니다</span>
      </div>
      <div className="vp-grid">
        {DECK_STYLES.map((st) => {
          const on = value === st.id;
          return (
            <button key={st.id} type="button" className={`vp-card${on ? " on" : ""}`} onClick={() => onChange(st.id)}>
              <div className="vp-canvas">
                <SlideCanvas
                  slide={slide}
                  accentColor={skeleton.accentColor}
                  variant={st.id}
                  pageNo={slide.no}
                  total={skeleton.slides.length}
                  sectionTitle={sectionTitleOf(slide.sectionKey)}
                  brand={brandMark(skeleton.companyName)}
                />
              </div>
              <div className="vp-meta">
                <span className="vp-label">
                  {on ? "✓ " : ""}
                  {st.label}
                </span>
                <span className="vp-blurb">{st.blurb}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
