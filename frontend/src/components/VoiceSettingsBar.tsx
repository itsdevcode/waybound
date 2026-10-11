"use client";

import React, { useState } from "react";
import { Volume2, VolumeX, Sparkles, ChevronDown, Check } from "lucide-react";
import type { VoiceNarrationState } from "@/hooks/useVoiceNarration";

interface VoiceSettingsBarProps {
  narration: VoiceNarrationState;
}

export function VoiceSettingsBar({ narration }: VoiceSettingsBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const {
    isSupported,
    isMuted,
    toggleMute,
    voices,
    selectedVoice,
    selectVoice,
  } = narration;

  if (!isSupported) {
    return null;
  }

  // Filter top English voices for clean selection
  const englishVoices = voices.filter(
    (v) => v.lang.startsWith("en") || v.lang.startsWith("en-")
  );
  const displayVoices = englishVoices.length > 0 ? englishVoices : voices;

  return (
    <div className="relative inline-flex items-center">
      <div className="flex items-center rounded-xl border border-purple-800/40 bg-purple-950/40 p-0.5 text-xs">
        {/* Mute / Unmute Button */}
        <button
          onClick={toggleMute}
          className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-medium transition cursor-pointer ${
            isMuted
              ? "text-purple-400/70 hover:text-purple-200"
              : "text-amber-300 hover:text-amber-200 bg-purple-900/50"
          }`}
          title={isMuted ? "Unmute AI Game Master" : "Mute AI Game Master"}
          aria-label={isMuted ? "Unmute AI Game Master voice" : "Mute AI Game Master voice"}
          aria-pressed={!isMuted}
        >
          {isMuted ? (
            <>
              <VolumeX className="h-3.5 w-3.5 text-purple-400" />
              <span className="text-[11px] hidden sm:inline">Voice Muted</span>
            </>
          ) : (
            <>
              <Volume2 className="h-3.5 w-3.5 text-amber-400 animate-pulse motion-reduce:animate-none" />
              <span className="text-[11px] hidden sm:inline">Game Master Voice</span>
            </>
          )}
        </button>

        {/* Voice Selector Menu Toggle (if multiple voices available) */}
        {!isMuted && displayVoices.length > 1 && (
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex items-center gap-0.5 border-l border-purple-800/40 pl-1.5 pr-2 py-1.5 text-purple-300 hover:text-white transition"
            title="Choose Game Master voice"
            aria-label="Choose Game Master voice"
            aria-expanded={menuOpen}
          >
            <Sparkles className="h-3 w-3 text-amber-400" />
            <ChevronDown className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Voice selection dropdown */}
      {menuOpen && !isMuted && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setMenuOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute right-0 top-full mt-1.5 z-50 w-56 rounded-2xl border border-purple-700/60 bg-[#120d24] shadow-2xl p-1.5 space-y-1 animate-in fade-in zoom-in-95 duration-150">
            <div className="px-2 py-1 text-[10px] font-bold tracking-wider text-purple-400 uppercase">
              Narrator Voice
            </div>
            <div className="max-h-48 overflow-y-auto space-y-0.5 custom-scrollbar">
              {displayVoices.map((voice) => {
                const isSelected = selectedVoice?.voiceURI === voice.voiceURI;
                return (
                  <button
                    key={voice.voiceURI}
                    onClick={() => {
                      selectVoice(voice.voiceURI);
                      setMenuOpen(false);
                    }}
                    className={`w-full flex items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs transition ${
                      isSelected
                        ? "bg-purple-800/60 text-amber-300 font-semibold"
                        : "text-purple-200 hover:bg-purple-900/40 hover:text-white"
                    }`}
                  >
                    <span className="truncate pr-1">
                      {voice.name.replace(/Google|Microsoft/g, "").trim() || voice.name}
                    </span>
                    {isSelected && <Check className="h-3 w-3 text-amber-400 shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
