"use client";

import { SparkWordmark } from "./SparkLogo";

/** 랜딩 화면. "시작하기"를 누르면 덱 창으로 들어간다. */
export default function Landing({ onStart }: { onStart: () => void }) {
  return (
    <div className="landing">
      <div className="landing-glow" aria-hidden="true" />
      <div className="landing-inner">
        <div className="landing-mark">
          <SparkWordmark fontSize={64} />
        </div>
        <p className="landing-tagline">
          업로드한 자료로 투자 피칭의 <strong>대본</strong>과 <strong>슬라이드 설계도</strong>를 만들고,
          SparkLabs 기준으로 <strong>진단·보완</strong>합니다.
        </p>

        <button className="rainbow landing-cta" onClick={onStart}>
          시작하기 →
        </button>
      </div>
      <div className="landing-foot">by SparkLabs</div>
    </div>
  );
}
