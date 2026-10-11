"use client";

import React, { useState } from "react";
import {
  Scroll,
  Lock,
  KeyRound,
  Compass,
  Clock,
  Sparkles,
  ChevronLeft,
  CheckCircle2,
  Loader2,
  Users,
  Shield,
  LogOut,
  Trash2,
} from "lucide-react";
import type { SharedPartyQuestResponse, PartyVerificationResponse } from "@/types/party";
import { useVoiceNarration } from "@/hooks/useVoiceNarration";
import { NarrationControls } from "@/components/NarrationControls";
import { VoiceSettingsBar } from "@/components/VoiceSettingsBar";
import { CoopVerifyModal } from "@/components/CoopVerifyModal";

interface CoopQuestViewProps {
  partyId: string;
  quest: SharedPartyQuestResponse;
  onBack: () => void;
  onRefresh: () => Promise<void>;
  onUnlockClue: (partyId: string, clueId: string) => Promise<void>;
  onVerifyArrival: (partyId: string, coords: { latitude: number; longitude: number }, answer: string) => Promise<PartyVerificationResponse>;
  onLeaveParty: (partyId: string) => Promise<void>;
  onDisbandParty: (partyId: string) => Promise<void>;
  isHost: boolean;
}

export function CoopQuestView({
  partyId,
  quest,
  onBack,
  onRefresh,
  onUnlockClue,
  onVerifyArrival,
  onLeaveParty,
  onDisbandParty,
  isHost,
}: CoopQuestViewProps) {
  const [unlockingClueId, setUnlockingClueId] = useState<string | null>(null);
  const [verifyModalOpen, setVerifyModalOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [exiting, setExiting] = useState(false);

  const narration = useVoiceNarration();

  const isCompleted = quest.status === "completed";
  const bothVerified = quest.my_verified && quest.partner_verified;

  async function handleUnlockClue(clueId: string) {
    setActionError(null);
    setUnlockingClueId(clueId);
    try {
      await onUnlockClue(partyId, clueId);
    } catch (err: unknown) {
      setActionError((err as Error)?.message || "Failed to unlock clue.");
    } finally {
      setUnlockingClueId(null);
    }
  }

  async function handleLeaveOrDisband() {
    const actionLabel = isHost ? "disband" : "leave";
    if (!confirm(`Are you sure you want to ${actionLabel} this cooperative fellowship? Active quest progress will be abandoned.`)) {
      return;
    }
    setActionError(null);
    setExiting(true);
    try {
      narration.stop();
      if (isHost) {
        await onDisbandParty(partyId);
      } else {
        await onLeaveParty(partyId);
      }
      onBack();
    } catch (err: unknown) {
      setActionError((err as Error)?.message || `Failed to ${actionLabel} party.`);
    } finally {
      setExiting(false);
    }
  }

  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      {/* Top Bar Navigation */}
      <div className="flex items-center justify-between border-b border-purple-900/60 pb-3">
        <button
          onClick={() => {
            narration.stop();
            onBack();
          }}
          className="flex items-center gap-1.5 text-xs font-semibold text-purple-300 hover:text-amber-300 transition cursor-pointer"
        >
          <ChevronLeft className="h-4 w-4" />
          <span>Fellowship Lobby</span>
        </button>

        <div className="flex items-center gap-2">
          <button
            onClick={() => void onRefresh()}
            className="rounded-lg border border-purple-800/60 bg-purple-950/40 px-2.5 py-1 text-[11px] font-medium text-purple-300 hover:bg-purple-900/40 transition cursor-pointer"
          >
            Refresh Status
          </button>
          <button
            onClick={handleLeaveOrDisband}
            disabled={exiting}
            className="flex items-center gap-1 rounded-lg border border-red-900/50 bg-red-950/30 px-2.5 py-1 text-[11px] font-medium text-red-300 hover:bg-red-900/40 transition cursor-pointer"
          >
            {isHost ? <Trash2 className="h-3 w-3" /> : <LogOut className="h-3 w-3" />}
            <span>{isHost ? "Disband" : "Leave"}</span>
          </button>
        </div>
      </div>

      {/* Voice Settings Bar */}
      <VoiceSettingsBar narration={narration} />

      {/* Error Banner */}
      {actionError && (
        <div className="rounded-xl bg-red-950/40 border border-red-800/60 p-3 text-xs text-red-200">
          {actionError}
        </div>
      )}

      {/* Quest Header Card */}
      <div className="rounded-2xl border border-purple-800/60 bg-gradient-to-b from-[#1b1130] to-[#0f091d] p-5 shadow-xl space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-purple-700/60 bg-purple-900/40 px-2.5 py-0.5 text-[10px] font-semibold text-purple-300">
              <Users className="h-3 w-3 text-amber-400" />
              <span>Two-Player Cooperative Mystery</span>
            </div>
            <h2 className="text-base font-bold text-purple-100">{quest.title}</h2>
          </div>

          <span
            className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
              isCompleted
                ? "bg-emerald-950/80 text-emerald-300 border border-emerald-700/60"
                : "bg-amber-950/80 text-amber-300 border border-amber-700/60"
            }`}
          >
            {quest.status}
          </span>
        </div>

        {/* Narrative & Voice Narration */}
        <div className="rounded-xl border border-purple-900/60 bg-purple-950/30 p-3.5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-purple-400">
              Shared Expedition Chronicle
            </span>
            <NarrationControls
              trackId="shared-story"
              textToNarrate={quest.description}
              activeTrackId={narration.activeTrackId}
              isPlaying={narration.isPlaying}
              isPaused={narration.isPaused}
              isMuted={narration.isMuted}
              isSupported={narration.isSupported}
              onPlay={narration.play}
              onPause={narration.pause}
              onResume={narration.resume}
              onStop={narration.stop}
              onReplay={narration.replay}
              variant="inline"
              label="Listen"
            />
          </div>
          <p className="text-xs text-purple-200/90 leading-relaxed italic font-serif">
            &ldquo;{quest.description}&rdquo;
          </p>
        </div>

        {/* Quest Meta Chips */}
        <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px] text-purple-300/80">
          <div className="flex items-center gap-1 rounded-lg bg-purple-900/30 px-2 py-1 border border-purple-800/40">
            <Clock className="h-3 w-3 text-amber-400" />
            <span>{quest.estimated_minutes} min</span>
          </div>
          <div className="flex items-center gap-1 rounded-lg bg-purple-900/30 px-2 py-1 border border-purple-800/40">
            <Sparkles className="h-3 w-3 text-amber-400" />
            <span>+{quest.reward_xp} XP per explorer</span>
          </div>
          <div className="flex items-center gap-1 rounded-lg bg-purple-900/30 px-2 py-1 border border-purple-800/40">
            <Shield className="h-3 w-3 text-amber-400" />
            <span className="capitalize">{quest.difficulty}</span>
          </div>
        </div>
      </div>

      {/* Partner Progress Status Card */}
      <div className="rounded-2xl border border-purple-900/60 bg-purple-950/20 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-purple-800/40 text-purple-200">
              <Users className="h-3.5 w-3.5" />
            </div>
            <div>
              <p className="text-xs font-bold text-purple-200">Partner: {quest.partner_display_name}</p>
              <p className="text-[10px] text-purple-400/70">Cooperative Progress Sync</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {quest.partner_verified ? (
              <span className="flex items-center gap-1 rounded-full bg-emerald-950/70 border border-emerald-700/60 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                <CheckCircle2 className="h-3 w-3" />
                <span>Verified Arrived</span>
              </span>
            ) : (
              <span className="flex items-center gap-1 rounded-full bg-amber-950/70 border border-amber-800/60 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                <span>Searching Landmark...</span>
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div className="rounded-xl border border-purple-900/50 bg-purple-950/40 p-2 text-center">
            <span className="text-[10px] text-purple-400/80 block">Partner Clues Revealed</span>
            <span className="font-bold text-purple-100">
              {quest.partner_clues_revealed} / {quest.partner_clues_count}
            </span>
          </div>
          <div className="rounded-xl border border-purple-900/50 bg-purple-950/40 p-2 text-center">
            <span className="text-[10px] text-purple-400/80 block">Location Privacy</span>
            <span className="font-medium text-emerald-300 text-[10px]">Coordinates Secret</span>
          </div>
        </div>
      </div>

      {/* Explorer's Assigned Clues */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Scroll className="h-4 w-4 text-amber-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-purple-200">
              Your Assigned Clues (Slot {quest.my_slot})
            </h3>
          </div>
          <span className="text-[11px] text-purple-400/70">
            Complementary Perspective
          </span>
        </div>

        <div className="space-y-2.5">
          {quest.my_clues.map((clue) => {
            const trackId = `clue-${clue.id}`;
            return (
              <div
                key={clue.id}
                className={`rounded-2xl border p-4 transition ${
                  clue.is_revealed
                    ? "border-purple-800/60 bg-gradient-to-b from-[#1b1130] to-[#120a22]"
                    : "border-purple-900/40 bg-purple-950/20 opacity-80"
                }`}
              >
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-purple-900/60 text-[10px] font-bold text-amber-300 border border-purple-700/50">
                      {clue.step_order}
                    </span>
                    <h4 className="text-xs font-semibold text-purple-100">{clue.clue_title}</h4>
                  </div>

                  {clue.is_revealed ? (
                    <NarrationControls
                      trackId={trackId}
                      textToNarrate={clue.clue_text}
                      activeTrackId={narration.activeTrackId}
                      isPlaying={narration.isPlaying}
                      isPaused={narration.isPaused}
                      isMuted={narration.isMuted}
                      isSupported={narration.isSupported}
                      onPlay={narration.play}
                      onPause={narration.pause}
                      onResume={narration.resume}
                      onStop={narration.stop}
                      onReplay={narration.replay}
                      variant="inline"
                      label="Listen"
                    />
                  ) : (
                    <span className="flex items-center gap-1 text-[10px] font-medium text-purple-400/70 bg-purple-950/50 px-2 py-0.5 rounded-full border border-purple-900/40">
                      <Lock className="h-3 w-3" />
                      <span>Locked</span>
                    </span>
                  )}
                </div>

                {clue.is_revealed ? (
                  <p className="text-xs text-purple-200/90 leading-relaxed font-sans pl-7">
                    {clue.clue_text}
                  </p>
                ) : (
                  <div className="pl-7 pt-1">
                    <button
                      onClick={() => handleUnlockClue(clue.id)}
                      disabled={unlockingClueId === clue.id}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-amber-600/60 bg-amber-600/20 px-3 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-600/30 transition cursor-pointer"
                    >
                      {unlockingClueId === clue.id ? (
                        <>
                          <Loader2 className="h-3 w-3 animate-spin" />
                          <span>Unlocking progressive clue...</span>
                        </>
                      ) : (
                        <>
                          <KeyRound className="h-3 w-3" />
                          <span>Unlock Clue #{clue.step_order}</span>
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Arrival Verification Section */}
      <div className="rounded-2xl border border-purple-800/60 bg-gradient-to-b from-[#180e2b] to-[#0f091c] p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Compass className="h-4 w-4 text-amber-400" />
            <h4 className="text-xs font-bold text-purple-100">Physical Arrival Verification</h4>
          </div>

          {quest.my_verified && (
            <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-300 bg-emerald-950/60 border border-emerald-700/60 px-2 py-0.5 rounded-full">
              <CheckCircle2 className="h-3 w-3" />
              <span>You Arrived</span>
            </span>
          )}
        </div>

        {isCompleted || bothVerified ? (
          <div className="rounded-xl border border-emerald-700/60 bg-emerald-950/40 p-4 space-y-2 text-center animate-in fade-in">
            <Sparkles className="h-6 w-6 text-amber-300 mx-auto" />
            <h3 className="text-sm font-bold text-emerald-100">Cooperative Mystery Solved!</h3>
            <p className="text-xs text-emerald-200">
              Discovered Destination: <span className="font-bold text-amber-300">{quest.destination_name || "Historical Courtyard"}</span>
            </p>
            <p className="text-[11px] text-emerald-300/80">
              Both explorers verified physical proximity and observation ground truth. XP awarded!
            </p>
          </div>
        ) : quest.my_verified ? (
          <div className="rounded-xl border border-amber-800/50 bg-amber-950/30 p-3.5 space-y-2 text-center">
            <div className="flex items-center justify-center gap-2 text-xs font-semibold text-amber-300">
              <span className="h-2 w-2 rounded-full bg-amber-400 animate-ping" />
              <span>Waiting for {quest.partner_display_name} to verify arrival...</span>
            </div>
            <p className="text-[11px] text-purple-300/70">
              You are checked in! Once your partner reaches the landmark and verifies, the quest completes.
            </p>
            <button
              onClick={() => void onRefresh()}
              className="mt-1 px-3 py-1.5 rounded-xl border border-purple-800/60 bg-purple-900/40 text-xs font-medium text-purple-200 hover:bg-purple-850 transition"
            >
              Check Partner Status
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-purple-300/80 leading-relaxed">
              When you have navigated to the hidden landmark using your complementary clues, submit your observation answer to verify presence.
            </p>
            <button
              onClick={() => setVerifyModalOpen(true)}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 py-3 text-xs font-bold text-white shadow-lg shadow-amber-950/60 transition cursor-pointer"
            >
              <Compass className="h-4 w-4" />
              <span>Arrived at Landmark — Verify Arrival</span>
            </button>
          </div>
        )}
      </div>

      {/* Verification Modal */}
      <CoopVerifyModal
        partyId={partyId}
        isOpen={verifyModalOpen}
        onClose={() => setVerifyModalOpen(false)}
        onVerify={(coords, ans) => onVerifyArrival(partyId, coords, ans)}
        onSuccess={() => {
          void onRefresh();
        }}
      />
    </div>
  );
}
