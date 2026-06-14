// Client-only UI preferences (not server state): small reactive flags persisted
// to localStorage. Module-level signals so any component can read them live and
// the Settings page can flip them.

import { createSignal } from "solid-js";

const LS_TICK_PULSE = "grindshell.prefs.tickPulse";

const loadBool = (key: string, fallback: boolean): boolean => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
};

const [tickPulseEnabled, setTickPulseSignal] = createSignal(loadBool(LS_TICK_PULSE, true));

/** Whether the action bar's per-tick cadence glow is shown (default on). */
export { tickPulseEnabled };

/** Toggle the action-bar tick pulse, persisting the choice. */
export function setTickPulseEnabled(on: boolean) {
  setTickPulseSignal(on);
  try {
    localStorage.setItem(LS_TICK_PULSE, on ? "1" : "0");
  } catch {
    /* storage unavailable — keep the in-memory value */
  }
}
