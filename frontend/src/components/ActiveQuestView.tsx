"use client";

import React, { useState } from "react";
import {
  Scroll,
  Lock,
  Unlock,
  KeyRound,
  Compass,
  AlertTriangle,
  Clock,
  Sparkles,
  ChevronLeft,
  MapPin,
  CheckCircle2,
  Loader2,
  Eye,
} from "lucide-react";
import type { QuestResponse } from "@/types/api";
import { isSimulatedQuest } from "@/lib/utils";

interface ActiveQuestViewProps {
  quest: QuestResponse;
  onBack: () => void;
  onStartQuest: (questId: string) => Promise<void>;
  onUnlockHint: (questId: string) => Promise<void>;
  onOpenVerify: () => void;
  onAbandonQuest: (questId: string) => Promise<void>;
}

export function ActiveQuestView({
  quest,
  onBack,
  onStartQuest,
  onUnlockHint,
  onOpenVerify,
  onAbandonQuest,
}: ActiveQuestViewProps) {
  const [starting, setStarting] = useState(false);
  const [unlockingHint, setUnlockingHint] = useState(false);
  const [abandoning, setAbandoning] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const isDemo = isSimulatedQuest(quest);
  const isDraft = quest.status === "draft";
  const isActive = quest.status === "active";
  const isCompleted = quest.status === "completed";
  const isAbandoned = quest.status === "abandoned";

  async function handleStart() {
    setActionError(null);
    setStarting(true);
    try {
      await onStartQuest(quest.id);
    } catch (err: unknown) {
      setActionError((err as Error)?.message || "Failed to start quest.");
    } finally {
      setStarting(false);
    }
  }

  async function handleUnlockHint() {
    setActionError(null);
    setUnlockingHint(true);
    try {
      await onUnlockHint(quest.id);
    } catch (err: unknown) {
      setActionError((err as Error)?.message || "Failed to unlock next hint.");
    } finally {
      setUnlockingHint(false);
    }
  }

  async function handleAbandon() {
    if (!confirm("Are you sure you want to abandon this quest? This cannot be undone.")) {
      return;
    }
    setActionError(null);
    setAbandoning(true);
    try {
      await onAbandonQuest(quest.id);
    } catch (err: unknown) {
      setActionError((err as Error)?.message || "Failed to abandon quest.");
    } finally {
      setAbandoning(false);
    }
  }

  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      {/* Top Navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs text-purple-300 hover:text-white transition font-medium"
        >
          <ChevronLeft className="h-4 w-4" />
          <span>Dashboard</span>
        </button>

        <div className="flex items-center gap-2">
          {isDemo && (
            <span className="rounded bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-[10px] font-bold text-amber-300">
              Simulated Demo Quest
            </span>
          )}
          <span
            className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold capitalize ${
              isActive
                ? "bg-purple-500/20 text-purple-200 border-purple-500/40"
                : isCompleted
                ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                : isDraft
                ? "bg-blue-500/20 text-blue-300 border-blue-500/40"
                : "bg-slate-700/40 text-slate-300 border-slate-600/40"
            }`}
          >
            {quest.status}
          </span>
        </div>
      </div>

      {/* Quest Header Card */}
      <div className="card-runic rounded-3xl p-6 relative overflow-hidden space-y-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-purple-300/70">
            <span className="capitalize font-semibold text-amber-300">
              {quest.difficulty} Difficulty
            </span>
            <span>•</span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3 text-purple-400" />
              {quest.estimated_minutes} Minutes
            </span>
            <span>•</span>
            <span className="text-purple-300">
              {isDemo
                ? `${quest.reward_xp} XP Available (Simulated Demo)`
                : "Real-World Quest (0 XP - Provisional Ground Truth)"}
            </span>
          </div>

          <h1 className="text-xl sm:text-2xl font-black text-white tracking-wide">
            {quest.title}
          </h1>
        </div>

        {/* Quest Story Scroll */}
        <div className="rounded-2xl bg-black/40 border border-purple-900/60 p-4 space-y-2">
          <div className="flex items-center gap-2 text-[11px] font-bold tracking-wider text-purple-400 uppercase">
            <Scroll className="h-3.5 w-3.5 text-amber-400" />
            Field Transmission
          </div>
          <p className="text-sm text-slate-200 leading-relaxed font-sans italic">
            &ldquo;{quest.description}&rdquo;
          </p>
        </div>

        {/* Target Site Card (Secrecy enforced!) */}
        <div className="rounded-2xl border border-purple-800/40 bg-purple-950/20 p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-900/40 border border-purple-600/30 text-amber-400">
              {isCompleted ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-400" />
              ) : (
                <Lock className="h-5 w-5 text-amber-400" />
              )}
            </div>
            <div>
              <p className="text-[11px] text-purple-300/70 font-medium">Destination Secret</p>
              <p className="text-xs font-bold text-white">
                {isCompleted && quest.destination_name ? (
                  <span className="text-emerald-300">{quest.destination_name}</span>
                ) : (
                  <span className="text-purple-300/80">
                    Target Site Sealed (Hidden until arrival)
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Action Error Notice */}
      {actionError && (
        <div className="rounded-xl bg-red-950/60 border border-red-800/60 p-3.5 text-xs text-red-200 flex items-start gap-2.5">
          <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
          <span>{actionError}</span>
        </div>
      )}

      {/* Clues & Investigation Log */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-amber-400" />
            Progressive Clues ({quest.current_clues.length} Unlocked)
          </h2>

          {isActive && (
            <button
              onClick={handleUnlockHint}
              disabled={unlockingHint}
              className="text-xs text-amber-300 hover:text-amber-200 font-semibold flex items-center gap-1 transition disabled:opacity-50"
            >
              {unlockingHint ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>Unlocking...</span>
                </>
              ) : (
                <>
                  <Unlock className="h-3 w-3" />
                  <span>Unlock Next Clue</span>
                </>
              )}
            </button>
          )}
        </div>

        {quest.current_clues.length === 0 ? (
          <div className="card-runic rounded-2xl p-6 text-center space-y-2">
            <Lock className="h-8 w-8 text-purple-400 mx-auto" />
            <p className="text-xs font-semibold text-purple-200">
              All clues remain locked in the draft scroll.
            </p>
            <p className="text-[11px] text-purple-300/60">
              Start this quest to reveal your initial exploration clue.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {quest.current_clues.map((clue) => (
              <div
                key={clue.id}
                className="card-runic rounded-2xl p-4 border border-purple-800/40 space-y-1.5"
              >
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-bold text-amber-400 flex items-center gap-1.5">
                    <Sparkles className="h-3 w-3" />
                    Clue #{clue.step_order}
                  </span>
                  <span className="text-purple-300/60 text-[10px]">Unlocked</span>
                </div>
                <p className="text-xs text-slate-100 font-medium leading-relaxed">
                  {clue.clue}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Observation Challenge (if unlocked by active/completed status) */}
      {quest.verification_prompt && (
        <div className="card-runic-gold rounded-2xl p-4 space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold text-amber-300">
            <Eye className="h-4 w-4" />
            Field Observation Challenge
          </div>
          <p className="text-xs text-amber-100/90 leading-relaxed font-sans">
            {quest.verification_prompt}
          </p>
        </div>
      )}

      {/* Bottom Sticky Action Bar */}
      <div className="sticky bottom-4 z-30 pt-2">
        <div className="card-runic rounded-2xl p-3 border border-purple-600/50 shadow-2xl flex flex-col sm:flex-row gap-2.5">
          {isDraft && (
            <button
              onClick={handleStart}
              disabled={starting}
              id="start-quest-btn"
              className="btn-primary-rpg w-full flex items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-bold text-white shadow-lg disabled:opacity-50 cursor-pointer"
            >
              {starting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-amber-300" />
                  <span>Unsealing Quest...</span>
                </>
              ) : (
                <>
                  <Compass className="h-4 w-4 text-amber-300" />
                  <span>Embark on Quest (Unlock Clue #1)</span>
                </>
              )}
            </button>
          )}

          {isActive && (
            <>
              <button
                onClick={onOpenVerify}
                id="verify-quest-btn"
                className="btn-gold-rpg flex-1 flex items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-bold shadow-lg cursor-pointer"
              >
                <MapPin className="h-4 w-4" />
                <span>Verify Arrival & Answer</span>
              </button>

              <button
                onClick={handleAbandon}
                disabled={abandoning}
                className="rounded-xl border border-red-800/50 bg-red-950/40 px-4 py-3 text-xs font-semibold text-red-300 hover:bg-red-900/40 transition disabled:opacity-50"
              >
                {abandoning ? "Abandoning..." : "Abandon"}
              </button>
            </>
          )}

          {isCompleted && (
            <button
              onClick={onBack}
              className="btn-primary-rpg w-full flex items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-bold text-white shadow-lg cursor-pointer"
            >
              <CheckCircle2 className="h-4 w-4 text-emerald-300" />
              <span>Quest Completed — Return to Journal</span>
            </button>
          )}

          {isAbandoned && (
            <button
              onClick={onBack}
              className="w-full rounded-xl border border-purple-800/60 bg-purple-950/40 py-3 text-xs font-semibold text-purple-300 hover:bg-purple-900/40 transition"
            >
              Quest Abandoned — Return to Dashboard
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
