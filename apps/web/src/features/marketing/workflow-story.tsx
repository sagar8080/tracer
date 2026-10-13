"use client";

import { useRef, type CSSProperties } from "react";
import {
  ArrowRight,
  CalendarDays,
  Layers3,
  BarChart3,
  MousePointer2,
  Pause,
  Play,
  Check,
} from "lucide-react";
import { hours } from "@/lib/scheduling";
import { loads, people, actualMinutes } from "./sample";
import { useScenePlayback } from "./use-scene-playback";
import { PlanningSvg } from "./illustrations/planning-svg";
import s from "./workflow.module.css";

const steps = [
  {
    title: "Make space for the next idea.",
    label: "Plan the work",
    copy: "Move an allocation. Make room. Keep the whole week in view.",
    icon: CalendarDays,
  },
  {
    title: "Spot a busy day before it happens.",
    label: "Find the balance",
    copy: "Working hours and time off reveal where your people have room.",
    icon: Layers3,
  },
  {
    title: "Bring the real week back to the plan.",
    label: "Close the loop",
    copy: "Compare planned and recorded hours, then make the next week better.",
    icon: BarChart3,
  },
] as const;

export function WorkflowStory() {
  const player = useScenePlayback(steps.length);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div
      className={s.workflow}
      ref={player.rootRef}
      data-playing={player.playing}
      style={{ "--scene-duration": `${player.duration}ms` } as CSSProperties}
    >
      <div className={s.steps}>
        <div
          role="tablist"
          aria-label="Planning workflow"
          aria-orientation="vertical"
        >
          {steps.map(({ label, copy, icon: Icon }, i) => (
            <button
              key={label}
              role="tab"
              id={`workflow-tab-${i}`}
              aria-controls="workflow-scene"
              aria-selected={player.index === i}
              tabIndex={player.index === i ? 0 : -1}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              onClick={() => player.select(i)}
              onKeyDown={(event) => {
                let next = i;
                if (["ArrowDown", "ArrowRight"].includes(event.key))
                  next = (i + 1) % steps.length;
                else if (["ArrowUp", "ArrowLeft"].includes(event.key))
                  next = (i + steps.length - 1) % steps.length;
                else if (event.key === "Home") next = 0;
                else if (event.key === "End") next = steps.length - 1;
                else return;
                event.preventDefault();
                player.select(next);
                tabs.current[next]?.focus();
              }}
            >
              <span className={s.stepIndex}>0{i + 1}</span>
              <span>
                <strong>
                  <Icon size={16} />
                  {label}
                </strong>
                <small>{copy}</small>
              </span>
              {player.index === i && (
                <i
                  key={`${i}-${player.playing}`}
                  className={s.progress}
                  aria-hidden="true"
                />
              )}
            </button>
          ))}
        </div>
        <button
          className={s.playback}
          disabled={player.reduced}
          onClick={player.toggle}
          aria-label={
            player.requested
              ? "Pause workflow animation"
              : "Play workflow animation"
          }
        >
          {player.requested ? <Pause size={13} /> : <Play size={13} />}
          {player.reduced
            ? "Motion reduced"
            : player.requested
              ? "Pause animation"
              : "Play animation"}
        </button>
      </div>
      <div
        className={s.scene}
        id="workflow-scene"
        role="tabpanel"
        aria-labelledby={`workflow-tab-${player.index}`}
        tabIndex={0}
        onFocus={player.stop}
        onPointerDown={player.stop}
        onPointerEnter={() => player.setHeld(true)}
        onPointerLeave={() => player.setHeld(false)}
      >
        <div className={s.sceneTop}>
          <span>{steps[player.index].label}</span>
          <span>Illustrative workflow</span>
        </div>
        <div key={player.index} className={s.sceneBody}>
          <h3>{steps[player.index].title}</h3>
          {player.index === 0 ? (
            <PlanningScene playing={player.playing} />
          ) : player.index === 1 ? (
            <CapacityScene />
          ) : (
            <ActualsScene />
          )}
        </div>
        <div className={s.sceneBottom}>
          <span>People, projects, and one clear plan.</span>
          <span>0{player.index + 1} / 03</span>
        </div>
      </div>
    </div>
  );
}

function PlanningScene({ playing }: { playing: boolean }) {
  return (
    <div className={s.planScene} data-running={playing}>
      <PlanningSvg playing={playing} />
      <div className={s.planNote}>
        <MousePointer2 size={14} />
        <span>One move. A little more breathing room.</span>
        <ArrowRight size={14} />
      </div>
    </div>
  );
}

function CapacityScene() {
  return (
    <div className={s.capacityScene}>
      {people.slice(0, 3).map((person, i) => (
        <div className={s.loadRow} key={person.id}>
          <span className={s.person}>
            {person.name
              .split(" ")
              .map((n) => n[0])
              .join("")}
          </span>
          <div>
            <span>
              {person.name}
              <small>{loads[i].utilization}% planned</small>
            </span>
            <div className={s.loadRail}>
              <i
                style={{
                  width: `${Math.min(loads[i].utilization ?? 0, 100)}%`,
                  animationDelay: `${i * 90}ms`,
                }}
              />
            </div>
          </div>
          <span className={i === 1 ? s.warning : s.room}>
            {i === 1
              ? `${hours(loads[i].overload)}h over`
              : `${hours(loads[i].available)}h free`}
          </span>
        </div>
      ))}
      <div className={s.capacityNote}>
        <span className={s.warning}>Thu & Fri</span>
        <span>Oliver has 1h of overload each day.</span>
      </div>
    </div>
  );
}

function ActualsScene() {
  return (
    <div className={s.actualsScene}>
      <div className={s.legend}>
        <span>
          <i />
          Planned
        </span>
        <span>
          <i />
          Recorded
        </span>
      </div>
      {people.slice(0, 3).map((person, i) => (
        <div className={s.comparison} key={person.id}>
          <span>{person.name}</span>
          <div>
            <span style={{ width: `${(loads[i].planned / 2400) * 100}%` }}>
              {hours(loads[i].planned)}h
            </span>
            <span style={{ width: `${(actualMinutes[i] / 2400) * 100}%` }}>
              {hours(actualMinutes[i])}h
            </span>
          </div>
        </div>
      ))}
      <div className={s.actualsNote}>
        <Check size={13} />
        Recorded hours, ready to compare. Approvals stay separate.
      </div>
    </div>
  );
}
