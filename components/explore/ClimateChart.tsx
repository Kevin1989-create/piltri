"use client";

import { useState } from "react";
import { useUnitPreferences } from "@/lib/unitPreferences";

const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// viewBox units; the chart scales to its panel (~300-370 px wide), so text
// renders at roughly 8-10 px.
const W = 330;
const H = 160;
// Equal side margins, so the plot itself sits in the middle of the chart;
// the temperature labels use the left one.
const PAD = { top: 8, right: 26, bottom: 30, left: 26 };
const FONT = 9;
const HIGH = "#B4472F";
const LOW = "#4F7A94";
const RAIN = "#C9D9E3";
const RAIN_TEXT = "#5E7F94";
const INK = "#6B6155";
const GRID = "#E7E0D6";

/** Month-by-month normals (WorldClim 1970-2000): average daily high and low
 *  as lines on a labelled temperature scale, rainfall as bars with each
 *  month's amount written underneath - what an annual average hides (a
 *  17 °C year can be mild all year or 5 °C winters and 30 °C summers).
 *  Hovering (or tapping) a month shows its exact values. */
export function ClimateChart({ monthly }: { monthly: { highC: number[]; lowC: number[]; rainMm: number[] } }) {
  const { prefs } = useUnitPreferences();
  const [active, setActive] = useState<number | null>(null);
  const fahrenheit = prefs.temperature === "F";
  const inches = prefs.distance === "imperial";
  const t = (c: number) => (fahrenheit ? Math.round((c * 9) / 5 + 32) : c);
  const r = (mm: number) => (inches ? Math.round((mm / 25.4) * 10) / 10 : Math.round(mm));
  const tUnit = fahrenheit ? "°F" : "°C";
  const rUnit = inches ? "in" : "mm";

  const highs = monthly.highC.map(t);
  const lows = monthly.lowC.map(t);
  // A temperature scale on round numbers, with a gridline at each step.
  const step = Math.max(...highs) - Math.min(...lows) > 30 ? 10 : 5;
  const tLo = Math.floor(Math.min(...lows) / step) * step;
  const tHi = Math.max(Math.ceil(Math.max(...highs) / step) * step, tLo + 2 * step);
  const ticks = Array.from({ length: (tHi - tLo) / step + 1 }, (_, i) => tLo + i * step);
  const rainMax = Math.max(...monthly.rainMm, 100);

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const colW = plotW / 12;
  const x = (m: number) => PAD.left + colW * (m + 0.5);
  const yT = (v: number) => PAD.top + plotH - ((v - tLo) / (tHi - tLo)) * plotH;
  const line = (values: number[]) => values.map((v, m) => `${m ? "L" : "M"}${x(m).toFixed(1)},${yT(v).toFixed(1)}`).join(" ");
  const rainRowY = PAD.top + plotH + 10;
  const monthRowY = H - 5;

  return (
    <figure className="w-full relative select-none" onMouseLeave={() => setActive(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Monthly average high and low temperature and rainfall">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={yT(v)} y2={yT(v)} stroke={GRID} strokeWidth={0.6} />
            <text x={PAD.left - 4} y={yT(v) + 3} textAnchor="end" fontSize={FONT} fill={INK}>{`${v}°`}</text>
          </g>
        ))}
        {active != null && <rect x={x(active) - colW / 2} y={PAD.top} width={colW} height={plotH} fill="#E3B27A" opacity={0.18} />}
        {monthly.rainMm.map((mm, m) => {
          const h = (mm / rainMax) * plotH;
          return <rect key={m} x={x(m) - colW * 0.3} y={PAD.top + plotH - h} width={colW * 0.6} height={h} fill={RAIN} rx={1.5} />;
        })}
        <path d={line(highs)} fill="none" stroke={HIGH} strokeWidth={1.6} strokeLinejoin="round" />
        <path d={line(lows)} fill="none" stroke={LOW} strokeWidth={1.6} strokeLinejoin="round" />
        {highs.map((v, m) => (
          <circle key={`h${m}`} cx={x(m)} cy={yT(v)} r={active === m ? 3 : 1.8} fill={HIGH} />
        ))}
        {lows.map((v, m) => (
          <circle key={`l${m}`} cx={x(m)} cy={yT(v)} r={active === m ? 3 : 1.8} fill={LOW} />
        ))}
        {/* Each month's rainfall, then the month initials. */}
        <text x={PAD.left - 4} y={rainRowY} textAnchor="end" fontSize={FONT - 1} fill={RAIN_TEXT}>
          {rUnit}
        </text>
        {monthly.rainMm.map((mm, m) => (
          <text key={`r${m}`} x={x(m)} y={rainRowY} textAnchor="middle" fontSize={FONT - 1} fill={RAIN_TEXT} fontWeight={active === m ? 700 : 400}>
            {r(mm)}
          </text>
        ))}
        {MONTHS.map((label, m) => (
          <text key={m} x={x(m)} y={monthRowY} textAnchor="middle" fontSize={FONT} fill={INK} fontWeight={active === m ? 700 : 400}>
            {label}
          </text>
        ))}
        {/* Hover / tap targets, one per month column. */}
        {MONTHS.map((_, m) => (
          <rect
            key={`hit${m}`}
            x={x(m) - colW / 2}
            y={0}
            width={colW}
            height={H}
            fill="transparent"
            onMouseEnter={() => setActive(m)}
            onClick={() => setActive((a) => (a === m ? null : m))}
          />
        ))}
      </svg>
      {active != null && (
        <div
          className="absolute top-0 pointer-events-none rounded-md border border-surface-border bg-surface shadow-card px-2 py-1 text-[10px] leading-snug text-ink-700 whitespace-nowrap"
          style={{
            left: `${(x(active) / W) * 100}%`,
            transform: active < 3 ? "translateX(0)" : active > 8 ? "translateX(-100%)" : "translateX(-50%)",
          }}
        >
          <p className="font-medium text-ink-900">{MONTH_NAMES[active]}</p>
          <p>
            <span style={{ color: HIGH }}>High {highs[active]}{tUnit}</span> · <span style={{ color: LOW }}>Low {lows[active]}{tUnit}</span>
          </p>
          <p style={{ color: RAIN_TEXT }}>
            Rain {r(monthly.rainMm[active])} {rUnit}
          </p>
        </div>
      )}
      <figcaption className="mt-1 flex flex-wrap justify-center gap-x-3 gap-y-0.5 text-[10px] text-ink-500">
        <span className="flex items-center gap-1">
          <span className="inline-block w-2.5 h-0.5" style={{ background: HIGH }} /> Avg high ({tUnit})
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2.5 h-0.5" style={{ background: LOW }} /> Avg low ({tUnit})
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-sm" style={{ background: RAIN }} /> Rain ({rUnit} per month)
        </span>
        <span className="print:hidden">Hover or tap a month for its values</span>
      </figcaption>
    </figure>
  );
}
