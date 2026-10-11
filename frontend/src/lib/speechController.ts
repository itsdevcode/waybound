/**
 * WAYBOUND - Voice Game Master Centralized Speech Controller
 *
 * Provides a thread-safe, exclusive singleton manager for both browser Web Speech API
 * and ElevenLabs premium voice narration.
 * Guarantees:
 * 1. Single shared listener for voiceschanged (no handler clobbering across hooks).
 * 2. Monotonic utterance IDs preventing stale asynchronous callbacks from overwriting active state.
 * 3. Exclusive playback ownership (unmounting instances only cancel if they own active playback).
 * 4. Cross-component synchronization of mute, provider selection, and voice settings.
 * 5. Automatic graceful fallback to browser speech if ElevenLabs is unavailable or errors.
 */

import {
  isSpeechSynthesisSupported,
  getSavedVoiceMuted,
  setSavedVoiceMuted,
  getSavedVoiceUri,
  setSavedVoiceUri,
  getSavedVoiceProvider,
  setSavedVoiceProvider,
  cleanNarrationForSpeech,
  pickGameMasterVoice,
  type VoiceProvider,
} from "./speech";
import { api } from "./api";

export interface NarrationQuestContext {
  questId: string;
  contentType: "story" | "clue" | "completion";
  stepId?: string;
  voiceId?: string;
  modelId?: string;
}

export interface SpeechControllerState {
  isSupported: boolean;
  isMuted: boolean;
  provider: VoiceProvider;
  isLoadingAudio: boolean;
  elevenlabsAvailable: boolean;
  activeProvider: "browser" | "elevenlabs" | null;
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
  provider: "browser",
  isLoadingAudio: false,
  elevenlabsAvailable: false,
  activeProvider: null,
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
  private audioRef: HTMLAudioElement | null = null;
  private currentAudioUrl: string | null = null;
  private lastTrack: {
    trackId: string;
    text: string;
    ownerId: string;
    context?: NarrationQuestContext;
  } | null = null;
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
      provider: getSavedVoiceProvider(),
      isLoadingAudio: false,
      elevenlabsAvailable: false,
      activeProvider: null,
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
   * Check ElevenLabs configuration on the server.
   */
  public async refreshElevenLabsConfig(): Promise<void> {
    if (typeof window === "undefined") return;
    try {
      const config = await api.narration.getConfig();
      this.updateState({
        elevenlabsAvailable: Boolean(config?.enabled),
      });
    } catch {
      this.updateState({
        elevenlabsAvailable: false,
      });
    }
  }

  /**
   * Lazily initializes voice listeners and ElevenLabs config on the client side once.
   */
  public ensureInitialized(): void {
    if (this.initialized || typeof window === "undefined") {
      return;
    }
    this.initialized = true;

    this.loadVoices();
    this.refreshElevenLabsConfig();

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

  private cleanupAudio(): void {
    if (this.audioRef) {
      try {
        this.audioRef.pause();
        this.audioRef.onplay = null;
        this.audioRef.onpause = null;
        this.audioRef.onended = null;
        this.audioRef.onerror = null;
        this.audioRef.src = "";
      } catch {
        // ignore
      }
      this.audioRef = null;
    }

    if (this.currentAudioUrl) {
      try {
        URL.revokeObjectURL(this.currentAudioUrl);
      } catch {
        // ignore
      }
      this.currentAudioUrl = null;
    }
  }

  private cancelAnyCurrentPlayback(): void {
    this.cleanupAudio();

    if (typeof window !== "undefined" && window.speechSynthesis) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }

    this.currentUtteranceRef = null;
  }

  /**
   * Plays speech narration, claiming exclusive ownership for the specified ownerId.
   * If provider is 'elevenlabs' and questContext is given, fetches audio from the server.
   * Automatically falls back to browser TTS if ElevenLabs is unavailable, disabled, or fails.
   */
  public play(
    trackId: string,
    text: string,
    ownerId: string,
    context?: NarrationQuestContext
  ): void {
    if (this.state.provider === "off" || this.state.isMuted || !text.trim()) {
      return;
    }

    // If currently paused on this exact track, resume it
    if (this.state.activeTrackId === trackId && this.state.isPaused) {
      this.resume(ownerId);
      return;
    }

    // Cancel existing audio or speech
    this.cancelAnyCurrentPlayback();

    const thisUtteranceId = ++this.nextUtteranceId;
    this.currentUtteranceId = thisUtteranceId;
    this.lastTrack = { trackId, text, ownerId, context };

    // ElevenLabs provider flow
    if (this.state.provider === "elevenlabs" && context) {
      this.updateState({
        isLoadingAudio: true,
        isPlaying: false,
        isPaused: false,
        activeTrackId: trackId,
        activeOwnerId: ownerId,
        activeProvider: "elevenlabs",
      });

      api.narration
        .fetchAudioBlob({
          quest_id: context.questId,
          content_type: context.contentType,
          step_id: context.stepId,
          voice_id: context.voiceId,
          model_id: context.modelId,
        })
        .then((blob) => {
          // Stale callback check
          if (this.currentUtteranceId !== thisUtteranceId) {
            return;
          }

          const objectUrl = URL.createObjectURL(blob);
          this.currentAudioUrl = objectUrl;

          const audio = new Audio(objectUrl);
          this.audioRef = audio;

          audio.onplay = () => {
            if (this.currentUtteranceId !== thisUtteranceId) return;
            this.updateState({
              isPlaying: true,
              isPaused: false,
              isLoadingAudio: false,
              activeTrackId: trackId,
              activeOwnerId: ownerId,
              activeProvider: "elevenlabs",
            });
          };

          audio.onpause = () => {
            if (this.currentUtteranceId !== thisUtteranceId) return;
            if (!audio.ended) {
              this.updateState({
                isPaused: true,
                isPlaying: false,
              });
            }
          };

          audio.onended = () => {
            if (this.currentUtteranceId !== thisUtteranceId) return;
            this.cleanupAudio();
            this.updateState({
              isPlaying: false,
              isPaused: false,
              isLoadingAudio: false,
              activeTrackId: null,
              activeOwnerId: null,
              activeProvider: null,
            });
          };

          audio.onerror = () => {
            if (this.currentUtteranceId !== thisUtteranceId) return;
            console.warn("ElevenLabs audio element playback error. Falling back to browser TTS.");
            this.cleanupAudio();
            this.playBrowserSpeech(trackId, text, ownerId, thisUtteranceId);
          };

          audio.play().catch((err) => {
            if (this.currentUtteranceId !== thisUtteranceId) return;
            console.warn("Audio play() rejected. Falling back to browser TTS:", err);
            this.cleanupAudio();
            this.playBrowserSpeech(trackId, text, ownerId, thisUtteranceId);
          });
        })
        .catch((err) => {
          if (this.currentUtteranceId !== thisUtteranceId) return;
          console.warn("ElevenLabs synthesis request failed. Falling back to browser TTS:", err);
          this.playBrowserSpeech(trackId, text, ownerId, thisUtteranceId);
        });

      return;
    }

    // Default Browser Web Speech flow
    this.playBrowserSpeech(trackId, text, ownerId, thisUtteranceId);
  }

  private playBrowserSpeech(
    trackId: string,
    text: string,
    ownerId: string,
    utteranceId: number
  ): void {
    if (!this.state.isSupported) {
      this.updateState({
        isLoadingAudio: false,
        isPlaying: false,
        isPaused: false,
        activeTrackId: null,
        activeOwnerId: null,
        activeProvider: null,
      });
      return;
    }

    const cleanedText = cleanNarrationForSpeech(text);
    if (!cleanedText) {
      this.updateState({
        isLoadingAudio: false,
        isPlaying: false,
        isPaused: false,
        activeTrackId: null,
        activeOwnerId: null,
        activeProvider: null,
      });
      return;
    }

    try {
      const utterance = new SpeechSynthesisUtterance(cleanedText);
      if (this.state.selectedVoice) {
        utterance.voice = this.state.selectedVoice;
      }
      utterance.rate = 0.95;
      utterance.pitch = 1.0;

      utterance.onstart = () => {
        if (this.currentUtteranceId !== utteranceId) return;
        this.updateState({
          isPlaying: true,
          isPaused: false,
          isLoadingAudio: false,
          activeTrackId: trackId,
          activeOwnerId: ownerId,
          activeProvider: "browser",
        });
      };

      utterance.onend = () => {
        if (this.currentUtteranceId !== utteranceId) return;
        this.currentUtteranceRef = null;
        this.updateState({
          isPlaying: false,
          isPaused: false,
          isLoadingAudio: false,
          activeTrackId: null,
          activeOwnerId: null,
          activeProvider: null,
        });
      };

      utterance.onerror = (e) => {
        if (this.currentUtteranceId !== utteranceId) return;
        if (e.error !== "interrupted" && e.error !== "canceled") {
          console.warn("Speech synthesis notice:", e.error);
        }
        this.currentUtteranceRef = null;
        this.updateState({
          isPlaying: false,
          isPaused: false,
          isLoadingAudio: false,
          activeTrackId: null,
          activeOwnerId: null,
          activeProvider: null,
        });
      };

      utterance.onpause = () => {
        if (this.currentUtteranceId !== utteranceId) return;
        this.updateState({
          isPaused: true,
          isPlaying: false,
        });
      };

      utterance.onresume = () => {
        if (this.currentUtteranceId !== utteranceId) return;
        this.updateState({
          isPaused: false,
          isPlaying: true,
        });
      };

      this.currentUtteranceRef = utterance;
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.warn("Failed to invoke speech synthesis:", err);
      this.currentUtteranceRef = null;
      this.updateState({
        isPlaying: false,
        isPaused: false,
        isLoadingAudio: false,
        activeTrackId: null,
        activeOwnerId: null,
        activeProvider: null,
      });
    }
  }

  public pause(ownerId?: string): void {
    if (ownerId && this.state.activeOwnerId && this.state.activeOwnerId !== ownerId) return;

    try {
      if (this.state.activeProvider === "elevenlabs" && this.audioRef) {
        this.audioRef.pause();
        this.updateState({
          isPaused: true,
          isPlaying: false,
        });
      } else if (
        this.state.isSupported &&
        typeof window !== "undefined" &&
        window.speechSynthesis
      ) {
        if (this.state.isPlaying && !this.state.isPaused) {
          window.speechSynthesis.pause();
          this.updateState({
            isPaused: true,
            isPlaying: false,
          });
        }
      }
    } catch {
      // ignore
    }
  }

  public resume(ownerId?: string): void {
    if (ownerId && this.state.activeOwnerId && this.state.activeOwnerId !== ownerId) return;

    try {
      if (this.state.activeProvider === "elevenlabs" && this.audioRef) {
        this.audioRef.play().catch(() => {});
        this.updateState({
          isPaused: false,
          isPlaying: true,
        });
      } else if (
        this.state.isSupported &&
        typeof window !== "undefined" &&
        window.speechSynthesis
      ) {
        if (this.state.isPaused) {
          window.speechSynthesis.resume();
          this.updateState({
            isPaused: false,
            isPlaying: true,
          });
        }
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

    // Invalidate any pending callbacks
    this.currentUtteranceId = ++this.nextUtteranceId;
    this.cancelAnyCurrentPlayback();

    this.updateState({
      isPlaying: false,
      isPaused: false,
      isLoadingAudio: false,
      activeTrackId: null,
      activeOwnerId: null,
      activeProvider: null,
    });
  }

  public replay(ownerId?: string): void {
    if (this.lastTrack) {
      const activeOwner = ownerId || this.lastTrack.ownerId;
      this.play(
        this.lastTrack.trackId,
        this.lastTrack.text,
        activeOwner,
        this.lastTrack.context
      );
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

  public setProvider(provider: VoiceProvider): void {
    setSavedVoiceProvider(provider);
    if (provider === "off" || (this.state.isPlaying && provider !== this.state.provider)) {
      this.stop();
    }
    this.updateState({ provider });
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
    this.cancelAnyCurrentPlayback();
    this.nextUtteranceId = 0;
    this.currentUtteranceId = 0;
    this.lastTrack = null;
    this.initialized = false;
    this.state = this.createInitialState();
    this.notify();
  }
}

export const speechController = new SpeechController();
