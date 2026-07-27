"use client";

/**
 * SparkDeck 스파크 — SparkLabs처럼 위로 뻗는 부채꼴 빛살.
 * 원점은 SVG 아래쪽 중앙(50, 66)에 있고, 빛살이 위로 퍼진다.
 */
const OX = 50;
const OY = 66;

// [위쪽 기준 각도(°, +는 오른쪽), 안쪽반지름, 바깥반지름, 색, 굵기]
const RAYS: Array<[number, number, number, string, number]> = [
  [-86, 10, 30, "#2f9bff", 3],
  [-70, 12, 25, "#5b6ef5", 2.6],
  [-55, 10, 41, "#8b5cf6", 3],
  [-42, 13, 24, "#c04bd6", 2.6],
  [-30, 10, 47, "#ff4d9d", 3],
  [-17, 12, 29, "#e5484d", 2.6],
  [-5, 10, 43, "#ff5a5f", 3.2],
  [8, 13, 26, "#ff9e2c", 2.6],
  [21, 10, 50, "#ffd23f", 3],
  [34, 12, 30, "#8bd450", 2.6],
  [48, 10, 52, "#35c759", 3.4],
  [63, 12, 27, "#2f9e44", 2.6],
  [78, 10, 36, "#ff9e2c", 3],
];

export default function SparkLogo({ size = 60 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={(size * 72) / 100}
      viewBox="0 0 100 72"
      role="img"
      aria-label="SparkDeck"
      style={{ display: "block", overflow: "visible" }}
    >
      {RAYS.map(([deg, r0, r1, color, w], i) => {
        const a = (deg * Math.PI) / 180;
        const dx = Math.sin(a);
        const dy = -Math.cos(a);
        // Round to fixed precision so server- and client-rendered SVG attribute
        // strings match exactly — raw Math.sin/cos results can differ in the
        // last floating-point digit between environments and trip React
        // hydration ("42.48336610960711" vs "42.483366109607104").
        const r6 = (v: number) => Number(v.toFixed(6));
        return (
          <line
            key={i}
            x1={r6(OX + r0 * dx)}
            y1={r6(OY + r0 * dy)}
            x2={r6(OX + r1 * dx)}
            y2={r6(OY + r1 * dy)}
            stroke={color}
            strokeWidth={w}
            strokeLinecap="round"
          />
        );
      })}
    </svg>
  );
}

/**
 * SparkDeck 워드마크 — 검정 글자, "Spark"만 굵게, "Deck"은 보통.
 * 스파크 빛살을 270° 돌려 "S" 왼쪽에, 글자보다 크게 둔다.
 */
export function SparkWordmark({ fontSize = 22, color = "var(--text)" }: { fontSize?: number; color?: string }) {
  const burst = fontSize * 2.0;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        fontSize,
        lineHeight: 1,
        color,
        letterSpacing: "-0.01em",
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          transform: "rotate(270deg)",
          marginRight: fontSize * -0.28,
          pointerEvents: "none",
        }}
      >
        <SparkLogo size={burst} />
      </span>
      <span style={{ fontWeight: 800 }}>Spark</span>
      <span style={{ fontWeight: 400 }}>Deck</span>
    </span>
  );
}
