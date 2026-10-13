"use client";

import { useEffect, useState } from "react";
import { useScenePlayback } from "../use-scene-playback";

export function useIllustrationMotion() {
  const player = useScenePlayback(1);
  const [started, setStarted] = useState(false);
  useEffect(() => {
    if (player.playing) setStarted(true);
  }, [player.playing]);
  return { ...player, started };
}
