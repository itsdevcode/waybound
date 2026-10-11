"use client";

import React, { useState } from "react";
import { Volume2, VolumeX, Sparkles, ChevronDown, Check, Settings2 } from "lucide-react";
import type { VoiceNarrationState } from "@/hooks/useVoiceNarration";
import type { VoiceProvider } from "@/lib/speech";

interface VoiceSettingsBarProps {
  narration: VoiceNarrationState;
}

export function VoiceSettingsBar({ narration }: VoiceSettingsBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const {
    isSupported,
    isMuted,
    toggleMute,
    provider,
    setProvider,
    elevenlabsAvailable,
    isLoadingAudio,
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

  const isOff = provider === "off" || isMuted;

  return (
    <div className="relative inline-flex items-center">
      <div className="flex items-center rounded-xl border border-purple-800/40 bg-purple-950/40 p-0.5 text-xs">
        {/* Mute / Unmute / Provider quick toggle */}
        <button
          onClick={toggleMute}
          className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-medium transition cursor-pointer ${
            isOff
              ? "text-purple-400/70 hover:text-purple-200"
              : "text-amber-300 hover:text-amber-200 bg-purple-900/50"
          }`}
          title={isOff ? "Unmute AI Game Master voice" : "Mute AI Game Master voice"}
          aria-label={isOff ? "Unmute AI Game Master voice" : "Mute AI Game Master voice"}
          aria-pressed={!isOff}
        >
          {isOff ? (
            <>
              <VolumeX className="h-3.5 w-3.5 text-purple-400" />
              <span className="text-[11px] hidden sm:inline">Voice Off</span>
            </>
          ) : (
            <>
              <Volume2
                className={`h-3.5 w-3.5 ${
                  isLoadingAudio
                    ? "text-amber-300 animate-spin"
                    : "text-amber-400 animate-pulse motion-reduce:animate-none"
                }`}
              />
              <span className="text-[11px] hidden sm:inline">
                {provider === "elevenlabs" ? "ElevenLabs AI" : "Browser Voice"}
              </span>
            </>
          )}
        </button>

        {/* Settings & Voice Provider Menu Toggle */}
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="flex items-center gap-0.5 border-l border-purple-800/40 pl-1.5 pr-2 py-1.5 text-purple-300 hover:text-white transition cursor-pointer"
          title="Voice narration options and providers"
          aria-label="Voice narration settings"
          aria-expanded={menuOpen}
        >
          {provider === "elevenlabs" ? (
            <Sparkles className="h-3 w-3 text-amber-400" />
          ) : (
            <Settings2 className="h-3 w-3 text-purple-400 hover:text-white" />
          )}
          <ChevronDown className="h-3 w-3" />
        </button>
      </div>

      {/* Voice selection & Provider dropdown */}
      {menuOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setMenuOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute right-0 top-full mt-1.5 z-50 w-64 rounded-2xl border border-purple-700/60 bg-[#120d24] shadow-2xl p-2 space-y-2 animate-in fade-in zoom-in-95 duration-150">
            {/* Provider Selection */}
            <div>
              <div className="px-2 py-1 text-[10px] font-bold tracking-wider text-purple-400 uppercase">
                Voice Provider
              </div>
              <div className="grid grid-cols-3 gap-1 p-1 bg-black/40 rounded-xl border border-purple-900/50">
                {(
                  [
                    { id: "off", label: "Off" },
                    { id: "browser", label: "Browser" },
                    { id: "elevenlabs", label: "ElevenLabs" },
                  ] as { id: VoiceProvider; label: string }[]
                ).map((opt) => {
                  const isCurrent = provider === opt.id;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => {
                        setProvider(opt.id);
                        if (opt.id !== "off" && isMuted) {
                          toggleMute();
                        }
                      }}
                      className={`px-2 py-1.5 rounded-lg text-xs font-semibold transition text-center ${
                        isCurrent
                          ? "bg-purple-800 text-amber-300 shadow-sm"
                          : "text-purple-300 hover:text-white hover:bg-purple-900/40"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Provider status notes */}
            {provider === "elevenlabs" && (
              <div className="px-2 py-1 text-[11px] text-purple-300/80 rounded-lg bg-purple-950/40 border border-purple-800/40">
                {elevenlabsAvailable ? (
                  <p className="flex items-center gap-1.5 text-amber-300">
                    <Sparkles className="h-3 w-3 shrink-0" />
                    <span>Premium studio voice narration active.</span>
                  </p>
                ) : (
                  <p className="text-purple-400 text-[10px]">
                    ElevenLabs server status unconfigured — falling back to browser speech automatically.
                  </p>
                )}
              </div>
            )}

            {/* Browser Voice Selector if browser mode or fallback */}
            {provider === "browser" && displayVoices.length > 1 && (
              <div>
                <div className="px-2 py-1 text-[10px] font-bold tracking-wider text-purple-400 uppercase">
                  Browser Narrator Voice
                </div>
                <div className="max-h-40 overflow-y-auto space-y-0.5 custom-scrollbar p-0.5">
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
            )}
          </div>
        </>
      )}
    </div>
  );
}
