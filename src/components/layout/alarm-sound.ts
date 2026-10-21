"use client";

import * as React from "react";

const RING_EVERY_MS = 4_000;

/** Two short rising tones - loud enough to notice, no sound file needed. */
function ring(ctx: AudioContext) {
  const now = ctx.currentTime;
  [0, 0.35].forEach((offset, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = i === 0 ? 880 : 1175;
    gain.gain.setValueAtTime(0.0001, now + offset);
    gain.gain.exponentialRampToValueAtTime(0.25, now + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.3);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now + offset);
    osc.stop(now + offset + 0.32);
  });
}

// One audio context for every alarm on the page.
let shared: AudioContext | null = null;
const audio = () => (shared ??= new AudioContext());

/**
 * Rings every few seconds while `active`. Browsers only allow sound after the
 * person has clicked or typed on the page, so the audio is (re)started on
 * their first interaction; until then `soundBlocked` is true.
 */
export function useAlarmSound(active: boolean): { soundBlocked: boolean } {
  const [soundBlocked, setSoundBlocked] = React.useState(false);

  React.useEffect(() => {
    const unlock = () => void audio().resume().then(() => setSoundBlocked(false));
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  React.useEffect(() => {
    if (!active) return;
    const tick = () => {
      const ctx = audio();
      if (ctx.state !== "running") {
        setSoundBlocked(true);
        void ctx.resume();
        return;
      }
      ring(ctx);
    };
    tick();
    const timer = window.setInterval(tick, RING_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [active]);

  return { soundBlocked };
}
