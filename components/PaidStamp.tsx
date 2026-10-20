"use client";

import { useId, type CSSProperties } from "react";

/**
 * Navy "PAID" seal, drawn in SVG so it stays sharp in print and costs no
 * network request. The shape and wording intentionally mirror the rubber-stamp
 * sample the shop supplied; it is not a scan of that image.
 */
const SCALLOP = (() => {
  const cx = 100;
  const cy = 100;
  const outer = 96;
  const inner = 90.5;
  const points = 36;
  const coords: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const angle = (Math.PI * i) / points - Math.PI / 2;
    const radius = i % 2 === 0 ? outer : inner;
    coords.push(
      `${(cx + Math.cos(angle) * radius).toFixed(2)},${(
        cy +
        Math.sin(angle) * radius
      ).toFixed(2)}`
    );
  }
  return `M${coords.join(" L")} Z`;
})();

export function PaidStamp({ className = "" }: { className?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const topArc = `${uid}-top`;
  const bottomArc = `${uid}-bottom`;

  return (
    <svg
      data-paid-stamp
      role="img"
      aria-label="সম্পূর্ণ পরিশোধিত — PAID"
      viewBox="0 0 200 200"
      className={`select-none ${className}`}
      style={
        {
          printColorAdjust: "exact",
          WebkitPrintColorAdjust: "exact",
        } as CSSProperties
      }
    >
      <defs>
        <path id={topArc} d="M 29,100 A 71,71 0 0 1 171,100" />
        <path id={bottomArc} d="M 29,100 A 71,71 0 0 0 171,100" />
      </defs>

      {/* Scalloped navy rim */}
      <path d={SCALLOP} fill="#1e293b" />
      <circle cx="100" cy="100" r="84" fill="#ffffff" />

      {/* Double inner ring, slightly worn at the edges */}
      <circle
        cx="100"
        cy="100"
        r="81"
        fill="none"
        stroke="#1e293b"
        strokeWidth="2.5"
      />
      <circle
        cx="100"
        cy="100"
        r="73"
        fill="none"
        stroke="#1e293b"
        strokeWidth="1.2"
        strokeDasharray="4 2"
      />

      <text
        fill="#1e293b"
        fontSize="11"
        fontWeight="700"
        fontFamily="Arial, Helvetica, sans-serif"
        letterSpacing="2.6"
        textAnchor="middle"
      >
        <textPath href={`#${topArc}`} startOffset="50%">
          THANK YOU
        </textPath>
      </text>
      <text
        fill="#1e293b"
        fontSize="11"
        fontWeight="700"
        fontFamily="Arial, Helvetica, sans-serif"
        letterSpacing="2.6"
        textAnchor="middle"
      >
        <textPath href={`#${bottomArc}`} startOffset="50%">
          THANK YOU
        </textPath>
      </text>

      {/* Side stars */}
      <circle cx="25" cy="100" r="2.2" fill="#1e293b" />
      <circle cx="175" cy="100" r="2.2" fill="#1e293b" />

      <text
        x="100"
        y="114"
        fill="#1e293b"
        fontSize="46"
        fontWeight="900"
        fontFamily="Arial Black, Arial, Helvetica, sans-serif"
        letterSpacing="1.5"
        textAnchor="middle"
      >
        PAID
      </text>
    </svg>
  );
}
