"use client";

import { useUnitPreferences } from "@/lib/unitPreferences";

const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Sized for the ~230 px-wide section panel: labels render at ~9 px.
const W = 260;
const H = 130;
const PAD = { top: 10, right: 24, bottom: 16, left: 24 };
const FONT = 10;
const HIGH = "#B4472F";
const LOW = "#4F7A94";
const RAIN = "#C9D9E3";

/** Month-by-month normals (WorldClim 1970-2000): average daily high and low
 *  as lines, rainfall as bars - what an annual average hides (a 17 °C year
 *  can be mild all year or 5 °C winters and 30 °C summers). */
export function ClimateChart({ monthly }: { monthly: { highC: number[]; lowC: number[]; rainMm: number[] } }) {
  const { prefs } = useUnitPreferences();
  const fahrenheit = prefs.temperature === "F";
  const inches = prefs.distance === "imperial";
  const t = (c: number) => (fahrenheit ? Math.round((c * 9) / 5 + 32) : c);
  const r = (mm: number) => (inches ? Math.round((mm / 25.4) * 10) / 10 : mm);
  const tUnit = fahrenheit ? "°F" : "°C";
  const rUnit = inches ? "in" : "mm";

  const highs = monthly.highC.map(t);
  const lows = monthly.lowC.map(t);
  const tMin = Math.min(...lows);
  const tMax = Math.max(...highs);
  const span = Math.max(tMax - tMin, 10);
  const rainMax = Math.max(...monthly.rainMm, 100);

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const colW = plotW / 12;
  const x = (m: number) => PAD.left + colW * (m + 0.5);
  const yT = (v: number) => PAD.top + plotH - ((v - tMin) / span) * plotH;
  const line = (values: number[]) => values.map((v, m) => `${m ? "L" : "M"}${x(m).toFixed(1)},${yT(v).toFixed(1)}`).join(" ");

  return (
    <figure className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Monthly average high and low temperature and rainfall">
        {monthly.rainMm.map((mm, m) => {
          const h = (mm / rainMax) * plotH;
          return (
            <rect key={m} x={x(m) - colW * 0.3} y={PAD.top + plotH - h} width={colW * 0.6} height={h} fill={RAIN} rx={1.5}>
              <title>{`${MONTH_NAMES[m]}: high ${highs[m]}${tUnit}, low ${lows[m]}${tUnit}, rain ${r(mm)} ${rUnit}`}</title>
            </rect>
          );
        })}
        <path d={line(highs)} fill="none" stroke={HIGH} strokeWidth={1.8} strokeLinejoin="round" />
        <path d={line(lows)} fill="none" stroke={LOW} strokeWidth={1.8} strokeLinejoin="round" />
        {highs.map((v, m) => (
          <circle key={`h${m}`} cx={x(m)} cy={yT(v)} r={2} fill={HIGH} />
        ))}
        {lows.map((v, m) => (
          <circle key={`l${m}`} cx={x(m)} cy={yT(v)} r={2} fill={LOW} />
        ))}
        {/* Temperature scale (left) and rainfall scale (right). */}
        <text x={PAD.left - 5} y={yT(tMax) + 3} textAnchor="end" fontSize={FONT} fill="#6B6155">{`${tMax}°`}</text>
        <text x={PAD.left - 5} y={yT(tMin) + 3} textAnchor="end" fontSize={FONT} fill="#6B6155">{`${tMin}°`}</text>
        <text x={W - PAD.right + 5} y={PAD.top + 3} fontSize={FONT} fill="#6B6155">{`${r(rainMax)}`}</text>
        <text x={W - PAD.right + 5} y={PAD.top + plotH + 3} fontSize={FONT} fill="#6B6155">0</text>
        {MONTHS.map((label, m) => (
          <text key={m} x={x(m)} y={H - 5} textAnchor="middle" fontSize={FONT} fill="#6B6155">
            {label}
          </text>
        ))}
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-ink-500">
        <span className="flex items-center gap-1">
          <span className="inline-block w-2.5 h-0.5" style={{ background: HIGH }} /> Avg high ({tUnit})
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2.5 h-0.5" style={{ background: LOW }} /> Avg low ({tUnit})
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-sm" style={{ background: RAIN }} /> Rain ({rUnit}/month)
        </span>
      </figcaption>
    </figure>
  );
}
