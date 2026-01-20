/**
 * Sound system for HiddenHand poker game
 *
 * Uses Web Audio API for low-latency playback
 */

export type SoundName =
  | 'cardDeal'
  | 'cardFlip'
  | 'chipBet'
  | 'chipWin'
  | 'fold'
  | 'check'
  | 'allIn'
  | 'yourTurn'
  | 'timerWarning'
  | 'shuffle';

// Sound URLs - using free sounds from mixkit.co and freesound.org
// These are placeholder URLs - replace with actual hosted sounds
const SOUND_URLS: Record<SoundName, string> = {
  cardDeal: '/sounds/card-deal.mp3',
  cardFlip: '/sounds/card-flip.mp3',
  chipBet: '/sounds/chip-bet.mp3',
  chipWin: '/sounds/chip-win.mp3',
  fold: '/sounds/fold.mp3',
  check: '/sounds/check.mp3',
  allIn: '/sounds/all-in.mp3',
  yourTurn: '/sounds/your-turn.mp3',
  timerWarning: '/sounds/timer-warning.mp3',
  shuffle: '/sounds/shuffle.mp3',
};

// Volume levels for different sounds (0.0 to 1.0)
const SOUND_VOLUMES: Record<SoundName, number> = {
  cardDeal: 0.5,
  cardFlip: 0.5,
  chipBet: 0.6,
  chipWin: 0.7,
  fold: 0.4,
  check: 0.3,
  allIn: 0.8,
  yourTurn: 0.6,
  timerWarning: 0.5,
  shuffle: 0.4,
};

class SoundManager {
  private audioContext: AudioContext | null = null;
  private audioBuffers: Map<SoundName, AudioBuffer> = new Map();
  private enabled: boolean = true;
  private initialized: boolean = false;
  private initPromise: Promise<void> | null = null;

  /**
   * Initialize the audio context and preload sounds
   * Must be called after a user interaction (browser requirement)
   */
  async init(): Promise<void> {
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._doInit();
    return this.initPromise;
  }

  private async _doInit(): Promise<void> {
    if (this.initialized) return;

    try {
      // Create audio context
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

      // Preload all sounds in parallel
      const loadPromises = Object.entries(SOUND_URLS).map(async ([name, url]) => {
        try {
          const response = await fetch(url);
          if (!response.ok) {
            console.warn(`Sound not found: ${url}`);
            return;
          }
          const arrayBuffer = await response.arrayBuffer();
          const audioBuffer = await this.audioContext!.decodeAudioData(arrayBuffer);
          this.audioBuffers.set(name as SoundName, audioBuffer);
        } catch (error) {
          console.warn(`Failed to load sound ${name}:`, error);
        }
      });

      await Promise.all(loadPromises);
      this.initialized = true;
      console.log('Sound system initialized');
    } catch (error) {
      console.error('Failed to initialize sound system:', error);
    }
  }

  /**
   * Play a sound by name
   */
  play(name: SoundName): void {
    if (!this.enabled || !this.audioContext || !this.initialized) return;

    const buffer = this.audioBuffers.get(name);
    if (!buffer) {
      console.warn(`Sound not loaded: ${name}`);
      return;
    }

    try {
      // Resume context if suspended (browser autoplay policy)
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume();
      }

      // Create source and gain nodes
      const source = this.audioContext.createBufferSource();
      const gainNode = this.audioContext.createGain();

      source.buffer = buffer;
      gainNode.gain.value = SOUND_VOLUMES[name];

      source.connect(gainNode);
      gainNode.connect(this.audioContext.destination);

      source.start(0);
    } catch (error) {
      console.error(`Failed to play sound ${name}:`, error);
    }
  }

  /**
   * Enable or disable sounds
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    localStorage.setItem('hiddenhand-sounds-enabled', String(enabled));
  }

  /**
   * Check if sounds are enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Load enabled state from localStorage
   */
  loadEnabledState(): void {
    const stored = localStorage.getItem('hiddenhand-sounds-enabled');
    if (stored !== null) {
      this.enabled = stored === 'true';
    }
  }
}

// Singleton instance
export const soundManager = new SoundManager();

// React hook for using sounds
import { useCallback, useEffect, useState } from 'react';

export function useSounds() {
  const [soundsEnabled, setSoundsEnabled] = useState(true);

  useEffect(() => {
    soundManager.loadEnabledState();
    setSoundsEnabled(soundManager.isEnabled());
  }, []);

  const playSound = useCallback((name: SoundName) => {
    soundManager.play(name);
  }, []);

  const toggleSounds = useCallback(() => {
    const newEnabled = !soundManager.isEnabled();
    soundManager.setEnabled(newEnabled);
    setSoundsEnabled(newEnabled);
  }, []);

  const initSounds = useCallback(async () => {
    await soundManager.init();
  }, []);

  return {
    playSound,
    toggleSounds,
    initSounds,
    soundsEnabled,
  };
}
