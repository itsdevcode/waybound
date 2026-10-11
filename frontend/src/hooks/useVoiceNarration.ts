"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  isSpeechSynthesisSupported,
  getSavedVoiceMuted,
  setSavedVoiceMuted,
  getSavedVoiceUri,
  setSavedVoiceUri,
  cleanNarrationForSpeech,
  pickGameMasterVoice,
} from "@/lib/speech";

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

export function useVoiceNarration(): VoiceNarrationState {
  const [isSupported] = useState<boolean>(() => {
    return isSpeechSynthesisSupported();
  });
  const [isMuted, setIsMutedState] = useState<boolean>(() => {
    return getSavedVoiceMuted();
  });
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [activeTrackId, setActiveTrackId] = useState<string | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<SpeechSynthesisVoice | null>(null);

  // Store last track and text for replay capability
  const lastTrackRef = useRef<{ trackId: string; text: string } | null>(null);
  // Store utterance reference to prevent garbage collection during playback
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Subscribe to voices and handle cleanup on unmount
  useEffect(() => {
    if (!isSupported) return;

    const loadVoices = () => {
      try {
        const available = window.speechSynthesis.getVoices();
        if (available && available.length > 0) {
          setVoices(available);
          const savedUri = getSavedVoiceUri();
          const chosen = pickGameMasterVoice(available, savedUri);
          setSelectedVoice(chosen);
        }
      } catch {
        // Ignore voice loading exceptions
      }
    };

    loadVoices();
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }

    return () => {
      // Safety cleanup on unmount: stop speech immediately
      if (typeof window !== "undefined" && window.speechSynthesis) {
        try {
          window.speechSynthesis.cancel();
          window.speechSynthesis.onvoiceschanged = null;
        } catch {
          // ignore
        }
      }
      utteranceRef.current = null;
    };
  }, [isSupported]);

  // Stop playback cleanly
  const stop = useCallback(() => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }
    utteranceRef.current = null;
    setIsPlaying(false);
    setIsPaused(false);
    setActiveTrackId(null);
  }, []);

  // Pause playback
  const pause = useCallback(() => {
    if (!isSupported || typeof window === "undefined" || !window.speechSynthesis) return;
    try {
      if (isPlaying && !isPaused) {
        window.speechSynthesis.pause();
        setIsPaused(true);
        setIsPlaying(false);
      }
    } catch {
      // ignore
    }
  }, [isSupported, isPlaying, isPaused]);

  // Resume playback
  const resume = useCallback(() => {
    if (!isSupported || typeof window === "undefined" || !window.speechSynthesis) return;
    try {
      if (isPaused) {
        window.speechSynthesis.resume();
        setIsPaused(false);
        setIsPlaying(true);
      }
    } catch {
      // ignore
    }
  }, [isSupported, isPaused]);

  // Speak a specific track
  const play = useCallback(
    (trackId: string, text: string) => {
      if (!isSupported || isMuted || !text.trim()) {
        return;
      }

      // If already playing this exact track and paused, simply resume
      if (activeTrackId === trackId && isPaused) {
        resume();
        return;
      }

      // If already playing this track actively, restart it cleanly
      if (typeof window !== "undefined" && window.speechSynthesis) {
        try {
          window.speechSynthesis.cancel();
        } catch {
          // ignore
        }
      }

      const cleanedText = cleanNarrationForSpeech(text);
      if (!cleanedText) return;

      lastTrackRef.current = { trackId, text: cleanedText };

      try {
        const utterance = new SpeechSynthesisUtterance(cleanedText);

        if (selectedVoice) {
          utterance.voice = selectedVoice;
        }

        // Engaging storyteller pace and natural pitch
        utterance.rate = 0.95;
        utterance.pitch = 1.0;

        utterance.onstart = () => {
          setIsPlaying(true);
          setIsPaused(false);
          setActiveTrackId(trackId);
        };

        utterance.onend = () => {
          setIsPlaying(false);
          setIsPaused(false);
          setActiveTrackId(null);
          utteranceRef.current = null;
        };

        utterance.onerror = (e) => {
          // 'interrupted' or 'canceled' are standard when stopping/switching
          if (e.error !== "interrupted" && e.error !== "canceled") {
            console.warn("Speech synthesis notice:", e.error);
          }
          setIsPlaying(false);
          setIsPaused(false);
          setActiveTrackId(null);
          utteranceRef.current = null;
        };

        utterance.onpause = () => {
          setIsPaused(true);
          setIsPlaying(false);
        };

        utterance.onresume = () => {
          setIsPaused(false);
          setIsPlaying(true);
        };

        utteranceRef.current = utterance;
        window.speechSynthesis.speak(utterance);
      } catch (err) {
        console.warn("Failed to invoke speech synthesis:", err);
        setIsPlaying(false);
        setIsPaused(false);
        setActiveTrackId(null);
      }
    },
    [isSupported, isMuted, activeTrackId, isPaused, selectedVoice, resume]
  );

  // Replay last played track
  const replay = useCallback(() => {
    if (lastTrackRef.current) {
      play(lastTrackRef.current.trackId, lastTrackRef.current.text);
    }
  }, [play]);

  // Set mute state and persist
  const setMuted = useCallback(
    (muted: boolean) => {
      setIsMutedState(muted);
      setSavedVoiceMuted(muted);
      if (muted) {
        stop();
      }
    },
    [stop]
  );

  // Toggle mute
  const toggleMute = useCallback(() => {
    setMuted(!isMuted);
  }, [isMuted, setMuted]);

  // Select preferred voice
  const selectVoice = useCallback(
    (voiceUri: string) => {
      const match = voices.find((v) => v.voiceURI === voiceUri);
      if (match) {
        setSelectedVoice(match);
        setSavedVoiceUri(voiceUri);
      }
    },
    [voices]
  );

  return {
    isSupported,
    isMuted,
    isPlaying,
    isPaused,
    activeTrackId,
    voices,
    selectedVoice,
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
