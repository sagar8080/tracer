"use client";

import { useState } from "react";
import { CircleAlert } from "lucide-react";
import { CapacitySvg } from "./illustrations/capacity-svg";
import { dailyTotals, loads } from "./sample";
import s from "./landing.module.css";

export function CapacityStory() {
  const [person, setPerson] = useState(false);
  const days = person
    ? loads[1].days.map((d) => ({ planned: d.planned, capacity: d.total }))
    : dailyTotals;
  const maximum = person ? 600 : 1860;
  return (
    <figure className={s.capacityFigure} data-reveal>
      <div className={s.chartTop}>
        <span>Room for the work</span>
        <span>Sample week</span>
      </div>
      <div
        className={s.chartSwitch}
        role="group"
        aria-label="Capacity chart perspective"
      >
        <button aria-pressed={!person} onClick={() => setPerson(false)}>
          Whole team
        </button>
        <button aria-pressed={person} onClick={() => setPerson(true)}>
          Oliver’s week <CircleAlert size={12} />
        </button>
      </div>
      <div className={s.chartLegend}>
        <span>
          <i />
          Planned hours
        </span>
        <span>
          <i />
          {person ? "Working hours" : "Team capacity"}
        </span>
      </div>
      <CapacitySvg key={String(person)} days={days} maximum={maximum} />
      <figcaption>
        <CircleAlert size={13} />
        {person
          ? "Oliver has 9h planned against 8h of working time on Thursday and Friday."
          : "Team totals look comfortable. Oliver still has a 1h overload on Thursday and Friday."}
      </figcaption>
    </figure>
  );
}
