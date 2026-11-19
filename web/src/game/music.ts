import { useSyncExternalStore } from 'react';
import track from '../../../assets/audio/bgm.m4a?url';

const KEY = 'three-kingdoms.music';
const VOLUME = 0.45;

function wanted(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

/**
 * The background music: one track, looped for as long as the page is open and in view.
 * Browsers refuse to start sound before the visitor has touched the page, so it begins at
 * the first click or key press.
 */
class Music {
  private audio: HTMLAudioElement | null = null;
  private on = wanted();
  private armed = false;
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  isOn = (): boolean => this.on;

  /** Call once. Starts the music at the first gesture and pauses it while the page is hidden. */
  arm(): void {
    if (this.armed) return;
    this.armed = true;
    const begin = () => {
      if (this.on) this.play();
    };
    window.addEventListener('pointerdown', begin, { once: true });
    window.addEventListener('keydown', begin, { once: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.audio?.pause();
      else if (this.on) this.play();
    });
  }

  toggle(): void {
    this.on = !this.on;
    try {
      localStorage.setItem(KEY, this.on ? 'on' : 'off');
    } catch {
      // Storage is unavailable; the choice lasts for this visit only.
    }
    if (this.on) this.play();
    else this.audio?.pause();
    for (const listener of this.listeners) listener();
  }

  private play(): void {
    if (!this.audio) {
      this.audio = new Audio(track);
      this.audio.loop = true;
      this.audio.volume = VOLUME;
    }
    // Refused until the visitor has touched the page; the first gesture tries again.
    this.audio.play().catch(() => {});
  }
}

export const music = new Music();

/** Whether the music is switched on, and a function that flips it. */
export function useMusic(): [boolean, () => void] {
  const on = useSyncExternalStore(music.subscribe, music.isOn);
  return [on, () => music.toggle()];
}
