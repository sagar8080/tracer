import { hours } from "@/lib/scheduling";
import type { CSSProperties } from "react";
import s from "./illustrations.module.css";

type CapacityDay = { planned: number; capacity: number };

export function CapacitySvg({
  days,
  maximum,
}: {
  days: CapacityDay[];
  maximum: number;
}) {
  return (
    <svg
      className={s.capacity}
      viewBox="0 0 360 204"
      role="group"
      aria-label="Sample daily capacity chart"
    >
      {[28, 72, 116, 162].map((y) => (
        <path key={y} d={`M14 ${y}H346`} className={s.grid} />
      ))}
      {days.map((day, i) => {
        const availableHeight = (day.capacity / maximum) * 134;
        const plannedHeight = (day.planned / maximum) * 134;
        const x = 21 + i * 67;
        const overload = day.planned > day.capacity;
        return (
          <g
            key={i}
            role="img"
            aria-label={`${["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"][i]}: ${hours(day.planned)} hours planned, ${hours(day.capacity)} hours capacity`}
            style={{ "--bar-delay": `${i * 70}ms` } as CSSProperties}
          >
            <rect
              x={x}
              y={162 - availableHeight}
              width="44"
              height={availableHeight}
              rx="3"
              className={s.capacityOutline}
            />
            <text
              x={x + 22}
              y={152 - Math.max(availableHeight, plannedHeight)}
              textAnchor="middle"
              className={s.capacityLabel}
            >
              {hours(day.capacity)}h
            </text>
            <g transform={`translate(${x + 6} 162)`}>
              <rect
                y={-plannedHeight}
                width="32"
                height={plannedHeight}
                rx="3"
                className={`${s.plannedBar} ${overload ? s.overloadedBar : ""}`}
              />
            </g>
            {overload && (
              <path
                d={`M${x - 3} ${162 - availableHeight}h50`}
                className={s.overloadLimit}
              />
            )}
            <text
              x={x + 22}
              y="152"
              textAnchor="middle"
              className={`${s.plannedLabel} ${overload ? s.overloadedLabel : ""}`}
            >
              {hours(day.planned)}h
            </text>
            <text x={x + 22} y="187" textAnchor="middle" className={s.day}>
              {["Mon", "Tue", "Wed", "Thu", "Fri"][i]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
