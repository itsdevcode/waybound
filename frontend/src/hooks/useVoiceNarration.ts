"use client";

import { useSyncExternalStore, useId, useCallback, useEffect } from "react";
import { speechController } from "@/lib/speechController";

export interface VoiceNarrationState {
  isSupported: boolean;
  isMuted: boolean;
  isPlaying: boolean;
  isPaused: boolean;
  activeTrackId: string | null;
  voices: SpeechSynthesisVoice[];
  selectedVoice: SpeechSynthesisVoice | null;
  play: (trackId: string, text: string) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  replay: () => void;
  toggleMute: () => void;
  setMuted: (muted: boolean) => void;
  selectVoice: (voiceUri: string) => void;
}

/**
 * Reusable client-side voice narration hook powered by a centralized
 * thread-safe speech controller.
 * 
 * Supports multiple simultaneous hook instances across the active quest,
 * modals, and dashboard without clobbering voiceschanged handlers or
 * prematurely cancelling speech on unmount.
 */
export function useVoiceNarration(customOwnerId?: string): VoiceNarrationState {
  const generatedId = useId();
  const ownerId = customOwnerId || generatedId;

  const state = useSyncExternalStore(
    speechController.subscribe,
    speechController.getSnapshot,
    speechController.getServerSnapshot
  );

  // Safe cleanup: only cancel playback if this instance actually owns the active speech
  useEffect(() => {
    return () => {
      speechController.releaseOwnership(ownerId);
    };
  }, [ownerId]);

  const play = useCallback(
    (trackId: string, text: string) => {
      speechController.play(trackId, text, ownerId);
    },
    [ownerId]
  );

  const pause = useCallback(() => {
    speechController.pause(ownerId);
  }, [ownerId]);

  const resume = useCallback(() => {
    speechController.resume(ownerId);
  }, [ownerId]);

  const stop = useCallback(() => {
    speechController.stop(ownerId);
  }, [ownerId]);

  const replay = useCallback(() => {
    speechController.replay(ownerId);
  }, [ownerId]);

  const toggleMute = useCallback(() => {
    speechController.toggleMute();
  }, []);

  const setMuted = useCallback((muted: boolean) => {
    speechController.setMuted(muted);
  }, []);

  const selectVoice = useCallback((voiceUri: string) => {
    speechController.selectVoice(voiceUri);
  }, []);

  return {
    isSupported: state.isSupported,
    isMuted: state.isMuted,
    isPlaying: state.isPlaying,
    isPaused: state.isPaused,
    activeTrackId: state.activeTrackId,
    voices: state.voices,
    selectedVoice: state.selectedVoice,
    play,
    pause,
    resume,
    stop,
    replay,
    toggleMute,
    setMuted,
    selectVoice,
  };
}
