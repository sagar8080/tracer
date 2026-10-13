"use client";

import { Check, Pause, Play } from "lucide-react";
import { SharedPlanSvg } from "./illustrations/shared-plan-svg";
import { useIllustrationMotion } from "./illustrations/use-illustration-motion";
import art from "./illustrations/illustrations.module.css";
import s from "./landing.module.css";

export function TeamVisual() {
  const motion = useIllustrationMotion();
  return (
    <figure className={s.teamVisual} data-reveal>
      <div className={s.teamVisualTop}>
        <span>One shared plan</span>
        <span className={art.sharedHeaderNote}>Illustrative workspace</span>
      </div>
      <div
        ref={motion.rootRef}
        className={art.sharedStage}
        data-started={motion.started}
        data-playing={motion.playing}
      >
        <SharedPlanSvg />
      </div>
      <figcaption>
        <span>
          <Check size={12} />
          Clear roles. Shared context.
        </span>
        <button
          className={art.motionControl}
          disabled={motion.reduced}
          onClick={motion.toggle}
          aria-label={
            motion.requested
              ? "Pause shared plan animation"
              : "Play shared plan animation"
          }
        >
          {motion.requested ? <Pause size={12} /> : <Play size={12} />}
          {motion.reduced
            ? "Motion reduced"
            : motion.requested
              ? "Pause animation"
              : "Play animation"}
        </button>
      </figcaption>
    </figure>
  );
}
