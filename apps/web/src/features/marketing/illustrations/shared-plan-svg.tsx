import { Bot, MousePointer2 } from "lucide-react";
import s from "./illustrations.module.css";

const connections = [
  { path: "M116 96C116 131 182 117 182 163", tone: s.sage },
  { path: "M300 96V163", tone: s.lilac },
  { path: "M484 96C484 131 418 117 418 163", tone: s.blue },
];

export function SharedPlanSvg() {
  return (
    <svg
      className={s.shared}
      viewBox="0 0 600 356"
      role="img"
      aria-label="Illustrative shared workspace: Maya reads her work, Noah plans the schedule, and a scoped agent proposes changes for review. Animated paths connect them to one plan."
    >
      {connections.map(({ path, tone }, i) => (
        <g
          key={path}
          className={tone}
          style={{ animationDelay: `${i * 400}ms` }}
        >
          <path d={path} className={s.connection} pathLength="100" />
          <path d={path} className={s.signal} pathLength="100" />
        </g>
      ))}
      {[
        { x: 116, initials: "MC", name: "Maya", role: "Member", tone: s.sage },
        {
          x: 300,
          initials: "NP",
          name: "Noah",
          role: "Planner",
          tone: s.lilac,
        },
        {
          x: 484,
          initials: null,
          name: "Agent",
          role: "Proposals",
          tone: s.blue,
        },
      ].map(({ x, initials, name, role, tone }) => (
        <g key={name} className={tone}>
          <circle cx={x} cy="51" r="26" className={s.identityRing} />
          <circle cx={x} cy="51" r="21" className={s.avatar} />
          {initials ? (
            <text
              x={x}
              y="57"
              textAnchor="middle"
              className={s.identityInitials}
            >
              {initials}
            </text>
          ) : (
            <Bot x={x - 11} y="40" width="22" height="22" />
          )}
          <text x={x} y="101" textAnchor="middle" className={s.identityName}>
            {name}
            <tspan className={s.identityRole}> · {role}</tspan>
          </text>
        </g>
      ))}
      <rect
        x="130"
        y="163"
        width="340"
        height="168"
        rx="9"
        className={s.planFrame}
      />
      <path
        d="M130 203H470M198 203V331M266 203V331M334 203V331M402 203V331"
        className={s.grid}
      />
      <text x="147" y="188" className={s.planTitle}>
        Studio · shared plan
      </text>
      <g transform="translate(148 219)" className={s.sage}>
        <rect width="183" height="24" rx="4" className={s.block} />
        <text x="9" y="16" className={s.projectTitle}>
          Atlas rebrand
        </text>
      </g>
      <g transform="translate(226 255)" className={s.lilac}>
        <rect width="225" height="24" rx="4" className={s.block} />
        <text x="9" y="16" className={s.projectTitle}>
          Studio website
        </text>
      </g>
      <g transform="translate(182 291)" className={s.blue}>
        <rect width="152" height="24" rx="4" className={s.block} />
        <text x="9" y="16" className={s.projectTitle}>
          Mobile app
        </text>
      </g>
      <g transform="translate(299 238)" className={s.sage}>
        <g className={s.memberPointer}>
          <MousePointer2 width="23" height="23" className={s.pointer} />
          <rect
            x="19"
            y="20"
            width="55"
            height="22"
            rx="4"
            className={s.pointerTag}
          />
          <text x="46" y="35" textAnchor="middle" className={s.pointerName}>
            Maya
          </text>
        </g>
      </g>
      <g transform="translate(380 272)" className={s.lilac}>
        <g className={s.plannerPointer}>
          <MousePointer2 width="23" height="23" className={s.pointer} />
          <rect
            x="19"
            y="20"
            width="55"
            height="22"
            rx="4"
            className={s.pointerTag}
          />
          <text x="46" y="35" textAnchor="middle" className={s.pointerName}>
            Noah
          </text>
        </g>
      </g>
      <circle cx="456" cy="180" r="3" className={s.planPresence} />
    </svg>
  );
}
