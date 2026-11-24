import { useLanguage } from "./language";
import { useId } from "react";
import { compactDay, dayIndex, shiftDay } from "../lib/dates";
import { rollingWeights, type WeighIn } from "../lib/trends";
import { Empty } from "./ui";

export function WeightPlot({ rows, today, days, large = false }: { rows: WeighIn[]; today: string; days: number; large?: boolean }) {
  const { t } = useLanguage();
  const id = useId().replace(/:/g, "");
  const first = shiftDay(today, -(days - 1));
  const points = rows.filter(({ day }) => day >= first && day <= today);
  if (points.length === 0) return <Empty icon="scale" title={t("记录体重后，这里会显示趋势。")}/>;
  const smooth = rollingWeights(rows).filter(({ day }) => day >= first && day <= today);
  const values = [...points, ...smooth].map((point) => point.kg);
  const lo = Math.floor((Math.min(...values) - 0.2) * 2) / 2;
  const hi = Math.ceil((Math.max(...values) + 0.2) * 2) / 2;
  const width = large ? 740 : 420;
  const height = large ? 225 : 143;
  const left = 32, right = width - 9, top = 13, bottom = height - 23;
  const x = (day: string) => left + (right - left) * (dayIndex(day) - dayIndex(first)) / (days - 1);
  const y = (kg: number) => bottom - (bottom - top) * (kg - lo) / (hi - lo);
  const line = (list: WeighIn[]) => list.map(({ day, kg }, index) => `${index ? "L" : "M"}${x(day)},${y(kg)}`).join(" ");
  const ticks = [hi, (hi + lo) / 2, lo];
  const dateMarks = [first, shiftDay(first, Math.round((days - 1) / 2)), today];
  const latest = points.at(-1)!;
  return <div className={`weight-plot ${large ? "plot-large" : ""}`}>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t`过去 ${days} 天体重趋势，最新 ${latest.kg} 公斤`}>
      <defs><linearGradient id={`shade${id}`} x2="0" y2="1" gradientUnits="objectBoundingBox">
        <stop stopColor="var(--accent)" stopOpacity=".20"/><stop offset="1" stopColor="var(--accent)" stopOpacity="0"/>
      </linearGradient></defs>
      {ticks.map((kg) => <g key={kg}>
        <text x={0} y={y(kg) + 4}>{kg.toFixed(kg % 1 ? 1 : 0)}</text>
        <path className="plot-grid" d={`M${left},${y(kg)}H${right}`}/>
      </g>)}
      {points.length > 1 && <path d={`${line(points)} L${x(latest.day)},${bottom} L${x(points[0].day)},${bottom} Z`} fill={`url(#shade${id})`}/>}
      <path className="plot-actual" d={line(points)}/>
      {smooth.length > 1 && <path className="plot-average" d={line(smooth)}/>}
      {points.map(({ day, kg }) => <circle key={day} cx={x(day)} cy={y(kg)} r={day === latest.day ? 4.1 : 2.2} fill="var(--accent)">
        <title>{compactDay(day)} · {kg} kg</title>
      </circle>)}
      {dateMarks.map((day, index) => <text key={day} x={x(day)} y={height - 3} textAnchor={index === 0 ? "start" : index === 2 ? "end" : "middle"}>
        {compactDay(day)}
      </text>)}
    </svg>
  </div>;
}
