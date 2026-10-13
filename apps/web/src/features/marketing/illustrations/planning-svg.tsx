import { MousePointer2 } from "lucide-react";
import s from "./illustrations.module.css";

export function PlanningSvg({ playing }: { playing: boolean }) {
  return (
    <svg
      className={s.planning}
      viewBox="0 0 560 212"
      role="img"
      aria-label="Illustrative allocation move: a two-hour draft design review moves from Tuesday to Thursday, alongside the team’s existing work."
      data-playing={playing}
    >
      {Array.from({ length: 6 }, (_, i) => (
        <path key={i} d={`M${48 + i * 100} 35V186`} className={s.grid} />
      ))}
      {["Mon", "Tue", "Wed", "Thu", "Fri"].map((day, i) => (
        <text
          key={day}
          x={98 + i * 100}
          y="20"
          textAnchor="middle"
          className={s.day}
        >
          {day}
        </text>
      ))}
      <path d="M0 36H548M0 111H548M0 186H548" className={s.grid} />
      {[
        { initials: "MC", y: 73, tone: s.sage },
        { initials: "OR", y: 149, tone: s.lilac },
      ].map(({ initials, y, tone }) => (
        <g key={initials} className={tone}>
          <circle cx="20" cy={y} r="16" className={s.avatar} />
          <text x="20" y={y + 4} textAnchor="middle" className={s.initials}>
            {initials}
          </text>
        </g>
      ))}
      <g transform="translate(53 48)" className={s.sage}>
        <rect width="288" height="40" rx="5" className={s.block} />
        <path d="M1 5V35" className={s.blockEdge} />
        <text x="12" y="17" className={s.allocationTitle}>
          Brand exploration
        </text>
        <text x="12" y="31" className={s.allocationMeta}>
          6h / day
        </text>
      </g>
      <g transform="translate(53 130)" className={s.lilac}>
        <rect width="288" height="40" rx="5" className={s.block} />
        <path d="M1 5V35" className={s.blockEdge} />
        <text x="12" y="17" className={s.allocationTitle}>
          Website design
        </text>
        <text x="12" y="31" className={s.allocationMeta}>
          6h / day
        </text>
      </g>
      <g transform="translate(353 130)" className={s.blue}>
        <rect width="188" height="40" rx="5" className={s.block} />
        <path d="M1 5V35" className={s.blockEdge} />
        <text x="12" y="17" className={s.allocationTitle}>
          Product flows
        </text>
        <text x="12" y="31" className={s.allocationMeta}>
          5h / day
        </text>
      </g>
      <path
        d="M238 94C283 116 316 111 376 95"
        className={s.moveGuide}
        pathLength="1"
      />
      <g transform="translate(353 64)" className={s.sage}>
        <g className={s.movingAllocation}>
          <rect
            x="-3"
            y="3"
            width="194"
            height="46"
            rx="7"
            className={s.blockShadow}
          />
          <rect width="188" height="40" rx="5" className={s.draft} />
          <text x="12" y="17" className={s.allocationTitle}>
            Design review
          </text>
          <text x="12" y="31" className={s.allocationMeta}>
            2h · draft
          </text>
          <g transform="translate(111 32)" className={s.dragCursor}>
            <MousePointer2 width="24" height="24" />
            <rect x="20" y="19" width="51" height="20" rx="4" />
            <text x="45.5" y="32" textAnchor="middle">
              Move
            </text>
          </g>
        </g>
      </g>
    </svg>
  );
}
