/**
 * The player's optional displays (M10), both off until turned on: the "who is ahead" strip and the words
 * beside a computer seat saying what it is doing. Kept in localStorage when it is available; without it
 * they last for the visit.
 */
import { useSyncExternalStore } from 'react';

export type SettingName = 'strip' | 'intent';

const KEY = 'three-kingdoms.settings';

function read(): Record<SettingName, boolean> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Record<SettingName, unknown>>;
    return { strip: raw.strip === true, intent: raw.intent === true };
  } catch {
    return { strip: false, intent: false };
  }
}

let current = read();
const listeners = new Set<() => void>();

function toggle(name: SettingName): void {
  current = { ...current, [name]: !current[name] };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Storage is unavailable; the choice lasts for this visit only.
  }
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** One optional display: whether it is on, and its switch. */
export function useSetting(name: SettingName): [boolean, () => void] {
  const on = useSyncExternalStore(subscribe, () => current[name]);
  return [on, () => toggle(name)];
}
