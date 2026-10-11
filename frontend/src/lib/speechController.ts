/**
 * WAYBOUND - Voice Game Master Centralized Speech Controller
 *
 * Provides a thread-safe, exclusive singleton manager for the browser Web Speech API.
 * Guarantees:
 * 1. Single shared listener for voiceschanged (no handler clobbering across hooks).
 * 2. Monotonic utterance IDs preventing stale asynchronous callbacks from overwriting active state.
 * 3. Exclusive playback ownership (unmounting instances only cancel if they own active playback).
 * 4. Cross-component synchronization of mute and preferred voice settings.
 */

import {
  isSpeechSynthesisSupported,
  getSavedVoiceMuted,
  setSavedVoiceMuted,
  getSavedVoiceUri,
  setSavedVoiceUri,
  cleanNarrationForSpeech,
  pickGameMasterVoice,
} from "./speech";

export interface SpeechControllerState {
  isSupported: boolean;
  isMuted: boolean;
  isPlaying: boolean;
  isPaused: boolean;
  activeTrackId: string | null;
  activeOwnerId: string | null;
  voices: SpeechSynthesisVoice[];
  selectedVoice: SpeechSynthesisVoice | null;
}

const SERVER_SNAPSHOT: SpeechControllerState = {
  isSupported: false,
  isMuted: false,
  isPlaying: false,
  isPaused: false,
  activeTrackId: null,
  activeOwnerId: null,
  voices: [],
  selectedVoice: null,
};

export class SpeechController {
  private state: SpeechControllerState;
  private subscribers = new Set<() => void>();
  private nextUtteranceId = 0;
  private currentUtteranceId = 0;
  private currentUtteranceRef: SpeechSynthesisUtterance | null = null;
  private lastTrack: { trackId: string; text: string; ownerId: string } | null = null;
  private initialized = false;

  constructor() {
    this.state = this.createInitialState();
    this.subscribe = this.subscribe.bind(this);
    this.getSnapshot = this.getSnapshot.bind(this);
    this.getServerSnapshot = this.getServerSnapshot.bind(this);
  }

  private createInitialState(): SpeechControllerState {
    const supported = isSpeechSynthesisSupported();
    return {
      isSupported: supported,
      isMuted: getSavedVoiceMuted(),
      isPlaying: false,
      isPaused: false,
      activeTrackId: null,
      activeOwnerId: null,
      voices: [],
      selectedVoice: null,
    };
  }

  public loadVoices(): void {
    try {
      if (typeof window === "undefined" || !window.speechSynthesis) return;
      const available = window.speechSynthesis.getVoices();
      if (available && available.length > 0) {
        const savedUri = getSavedVoiceUri();
        const chosen = pickGameMasterVoice(available, savedUri);
        this.updateState({
          voices: available,
          selectedVoice: chosen,
        });
      }
    } catch {
      // ignore errors
    }
  }

  /**
   * Lazily initializes voice listeners on the client side once.
   */
  public ensureInitialized(): void {
    if (this.initialized || typeof window === "undefined" || !this.state.isSupported) {
      return;
    }
    this.initialized = true;

    this.loadVoices();

    if (window.speechSynthesis) {
      const onVoicesChanged = () => this.loadVoices();
      if (typeof window.speechSynthesis.addEventListener === "function") {
        window.speechSynthesis.addEventListener("voiceschanged", onVoicesChanged);
      } else {
        window.speechSynthesis.onvoiceschanged = onVoicesChanged;
      }
    }
  }

  public subscribe(listener: () => void): () => void {
    this.ensureInitialized();
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  }

  public getSnapshot(): SpeechControllerState {
    return this.state;
  }

  public getServerSnapshot(): SpeechControllerState {
    return SERVER_SNAPSHOT;
  }

  private updateState(partial: Partial<SpeechControllerState>): void {
    this.state = { ...this.state, ...partial };
    this.notify();
  }

  private notify(): void {
    for (const listener of this.subscribers) {
      try {
        listener();
      } catch (err) {
        console.warn("Speech listener error:", err);
      }
    }
  }

  /**
   * Plays a speech track, claiming exclusive ownership for the specified ownerId.
   * Cancels prior speech and invalidates prior utterance IDs.
   */
  public play(trackId: string, text: string, ownerId: string): void {
    if (!this.state.isSupported || this.state.isMuted || !text.trim()) {
      return;
    }

    // If currently paused on this exact track, simply resume
    if (this.state.activeTrackId === trackId && this.state.isPaused) {
      this.resume();
      return;
    }

    // Cancel any existing speech in the browser
    if (typeof window !== "undefined" && window.speechSynthesis) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }

    const cleanedText = cleanNarrationForSpeech(text);
    if (!cleanedText) return;

    // Invalidate any lingering callbacks from earlier utterances
    const thisUtteranceId = ++this.nextUtteranceId;
    this.currentUtteranceId = thisUtteranceId;
    this.lastTrack = { trackId, text: cleanedText, ownerId };

    try {
      const utterance = new SpeechSynthesisUtterance(cleanedText);
      if (this.state.selectedVoice) {
        utterance.voice = this.state.selectedVoice;
      }
      utterance.rate = 0.95;
      utterance.pitch = 1.0;

      utterance.onstart = () => {
        // Guard against stale callbacks
        if (this.currentUtteranceId !== thisUtteranceId) return;
        this.updateState({
          isPlaying: true,
          isPaused: false,
          activeTrackId: trackId,
          activeOwnerId: ownerId,
        });
      };

      utterance.onend = () => {
        // Guard against stale callbacks
        if (this.currentUtteranceId !== thisUtteranceId) return;
        this.currentUtteranceRef = null;
        this.updateState({
          isPlaying: false,
          isPaused: false,
          activeTrackId: null,
          activeOwnerId: null,
        });
      };

      utterance.onerror = (e) => {
        // Guard against stale callbacks
        if (this.currentUtteranceId !== thisUtteranceId) return;
        if (e.error !== "interrupted" && e.error !== "canceled") {
          console.warn("Speech synthesis notice:", e.error);
        }
        this.currentUtteranceRef = null;
        this.updateState({
          isPlaying: false,
          isPaused: false,
          activeTrackId: null,
          activeOwnerId: null,
        });
      };

      utterance.onpause = () => {
        if (this.currentUtteranceId !== thisUtteranceId) return;
        this.updateState({
          isPaused: true,
          isPlaying: false,
        });
      };

      utterance.onresume = () => {
        if (this.currentUtteranceId !== thisUtteranceId) return;
        this.updateState({
          isPaused: false,
          isPlaying: true,
        });
      };

      // Retain reference to prevent GC
      this.currentUtteranceRef = utterance;
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.warn("Failed to invoke speech synthesis:", err);
      this.currentUtteranceRef = null;
      this.updateState({
        isPlaying: false,
        isPaused: false,
        activeTrackId: null,
        activeOwnerId: null,
      });
    }
  }

  public pause(ownerId?: string): void {
    if (!this.state.isSupported || typeof window === "undefined" || !window.speechSynthesis) return;
    if (ownerId && this.state.activeOwnerId && this.state.activeOwnerId !== ownerId) return;

    try {
      if (this.state.isPlaying && !this.state.isPaused) {
        window.speechSynthesis.pause();
        this.updateState({
          isPaused: true,
          isPlaying: false,
        });
      }
    } catch {
      // ignore
    }
  }

  public resume(ownerId?: string): void {
    if (!this.state.isSupported || typeof window === "undefined" || !window.speechSynthesis) return;
    if (ownerId && this.state.activeOwnerId && this.state.activeOwnerId !== ownerId) return;

    try {
      if (this.state.isPaused) {
        window.speechSynthesis.resume();
        this.updateState({
          isPaused: false,
          isPlaying: true,
        });
      }
    } catch {
      // ignore
    }
  }

  /**
   * Stops playback. If ownerId is provided, stops only if caller owns playback or if unassigned.
   */
  public stop(ownerId?: string): void {
    if (ownerId && this.state.activeOwnerId && this.state.activeOwnerId !== ownerId) {
      return;
    }

    // Invalidate any pending utterance callbacks
    this.currentUtteranceId = ++this.nextUtteranceId;
    this.currentUtteranceRef = null;

    if (typeof window !== "undefined" && window.speechSynthesis) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }

    this.updateState({
      isPlaying: false,
      isPaused: false,
      activeTrackId: null,
      activeOwnerId: null,
    });
  }

  public replay(ownerId?: string): void {
    if (this.lastTrack) {
      const activeOwner = ownerId || this.lastTrack.ownerId;
      this.play(this.lastTrack.trackId, this.lastTrack.text, activeOwner);
    }
  }

  /**
   * Called during hook unmount. Only cancels playback if the unmounting instance owns it.
   */
  public releaseOwnership(ownerId: string): void {
    if (this.state.activeOwnerId === ownerId) {
      this.stop(ownerId);
    }
  }

  public setMuted(muted: boolean): void {
    setSavedVoiceMuted(muted);
    this.updateState({ isMuted: muted });
    if (muted) {
      this.stop();
    }
  }

  public toggleMute(): void {
    this.setMuted(!this.state.isMuted);
  }

  public selectVoice(voiceUri: string): void {
    const match = this.state.voices.find((v) => v.voiceURI === voiceUri);
    if (match) {
      setSavedVoiceUri(voiceUri);
      this.updateState({ selectedVoice: match });
    }
  }

  /**
   * Testing helper to reset internal singleton state between tests.
   */
  public resetForTesting(): void {
    this.nextUtteranceId = 0;
    this.currentUtteranceId = 0;
    this.currentUtteranceRef = null;
    this.lastTrack = null;
    this.initialized = false;
    this.state = this.createInitialState();
    this.notify();
  }
}

export const speechController = new SpeechController();
