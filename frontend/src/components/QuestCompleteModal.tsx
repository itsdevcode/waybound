"use client";

import React from "react";
import {
  Trophy,
  Sparkles,
  Award,
  MapPin,
  ArrowRight,
  Info,
} from "lucide-react";
import type { QuestVerificationResponse } from "@/types/api";
import { useVoiceNarration } from "@/hooks/useVoiceNarration";
import { NarrationControls } from "@/components/NarrationControls";

interface QuestCompleteModalProps {
  result: QuestVerificationResponse | null;
  isOpen: boolean;
  onClose: () => void;
}

export function QuestCompleteModal({
  result,
  isOpen,
  onClose,
}: QuestCompleteModalProps) {
  const narration = useVoiceNarration();

  if (!isOpen || !result) return null;

  const { reward_xp_awarded, total_xp, level, quest, message } = result;
  const isSimulation =
    quest.destination_name?.startsWith("[Simulated Demo]") ||
    message.includes("[Simulated Demo]");

  // Victory narration text composed STRICTLY from confirmed result data
  const victoryNarrationText = [
    `Expedition accomplished! Quest verified: ${quest.title}.`,
    quest.destination_name ? `Destination unlocked: ${quest.destination_name}.` : "",
    reward_xp_awarded > 0 ? `You earned ${reward_xp_awarded} experience points.` : "",
    message,
  ]
    .filter(Boolean)
    .join(" ");

  function handleClose() {
    narration.stop();
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in zoom-in-95 duration-250"
      role="dialog"
      aria-modal="true"
      aria-labelledby="victory-modal-title"
    >
      <div className="card-runic-gold w-full max-w-md rounded-3xl border-2 border-amber-400/60 shadow-2xl p-6 sm:p-7 text-center space-y-5 relative overflow-hidden">
        {/* Glow backdrop */}
        <div className="absolute -top-16 -left-16 h-40 w-40 rounded-full bg-amber-500/20 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-16 -right-16 h-40 w-40 rounded-full bg-purple-500/20 blur-3xl pointer-events-none" />

        {/* Victory Icon */}
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-amber-400 to-amber-600 shadow-xl shadow-amber-950/60 text-amber-950">
          <Trophy className="h-10 w-10" />
        </div>

        {/* Title */}
        <div className="space-y-1">
          <div className="flex items-center justify-center gap-1.5 text-xs font-bold text-amber-300 tracking-wider uppercase">
            <Sparkles className="h-3.5 w-3.5" />
            <span>Expedition Accomplished</span>
            <Sparkles className="h-3.5 w-3.5" />
          </div>
          <h2
            id="victory-modal-title"
            className="text-2xl font-black text-white tracking-wide"
          >
            Quest Verified!
          </h2>
          <p className="text-xs text-purple-200/80">{quest.title}</p>
        </div>

        {/* Spoken AI Game Master Victory Dispatch (User-initiated, not auto-played) */}
        <div className="flex justify-center">
          <NarrationControls
            trackId="victory-dispatch"
            textToNarrate={victoryNarrationText}
            activeTrackId={narration.activeTrackId}
            isPlaying={narration.isPlaying}
            isPaused={narration.isPaused}
            isMuted={narration.isMuted}
            isSupported={narration.isSupported}
            isLoading={narration.isLoadingAudio}
            questContext={{ questId: quest.id, contentType: "completion" }}
            onPlay={narration.play}
            onPause={narration.pause}
            onResume={narration.resume}
            onStop={narration.stop}
            onReplay={narration.replay}
            variant="prominent"
            label="Hear Game Master Dispatch"
          />
        </div>

        {/* Destination Unlocked Card */}
        <div className="rounded-2xl bg-black/40 border border-amber-500/30 p-4 space-y-1 text-left">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-amber-400 uppercase">
            <MapPin className="h-3.5 w-3.5" />
            Destination Unlocked
          </div>
          <p className="text-sm font-bold text-white">
            {quest.destination_name || "Secret Landmark Revealed"}
          </p>
        </div>

        {/* XP Awarded Section - CRITICAL SAFETY REQUIREMENT */}
        <div className="rounded-2xl bg-purple-950/40 border border-purple-800/40 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-purple-300 font-medium">XP Awarded</span>
            <span className="text-lg font-black text-amber-300 flex items-center gap-1">
              <Award className="h-4 w-4 text-amber-400" />
              {reward_xp_awarded > 0 ? `+${reward_xp_awarded} XP` : "0 XP"}
            </span>
          </div>

          {reward_xp_awarded === 0 && !isSimulation ? (
            <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-2 text-[11px] text-amber-200/90 text-left flex items-start gap-1.5">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-400" />
              <span>
                Real-world progression XP is held pending field-verified observation ground truth.
                Never displaying fabricated progression.
              </span>
            </div>
          ) : isSimulation ? (
            <div className="rounded-lg bg-purple-500/10 border border-purple-500/20 p-2 text-[10px] text-purple-200/90 text-left">
              Simulated demo quest completed under deterministic test rules.
            </div>
          ) : null}

          <div className="pt-2 border-t border-purple-900/40 flex justify-between text-xs text-purple-300">
            <span>Explorer Level: <strong className="text-white">Lv. {level}</strong></span>
            <span>Total XP: <strong className="text-amber-300">{total_xp} XP</strong></span>
          </div>
        </div>

        {/* Backend Completion Message */}
        <p className="text-[11px] text-slate-300 italic font-sans max-w-sm mx-auto">
          &ldquo;{message}&rdquo;
        </p>

        {/* Return Button */}
        <button
          onClick={handleClose}
          id="victory-return-btn"
          className="btn-primary-rpg w-full flex items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-bold text-white shadow-lg cursor-pointer"
        >
          <span>Return to Explorer Dashboard</span>
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
