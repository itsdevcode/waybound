"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Header } from "@/components/Header";
import { ProfileCard } from "@/components/ProfileCard";
import { QuestHistoryCard } from "@/components/QuestHistoryCard";
import { QuestSetupModal } from "@/components/QuestSetupModal";
import { ActiveQuestView } from "@/components/ActiveQuestView";
import { QuestVerifyModal } from "@/components/QuestVerifyModal";
import { QuestCompleteModal } from "@/components/QuestCompleteModal";
import { UserModal } from "@/components/UserModal";
import { api, getActiveUserId } from "@/lib/api";
import type {
  ProfileResponse,
  QuestCreateRequest,
  QuestResponse,
  QuestVerificationResponse,
  QuestVerifyRequest,
} from "@/types/api";
import { AlertTriangle, RefreshCw, Compass } from "lucide-react";

export default function HomePage() {
  const [userId, setUserId] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return getActiveUserId();
    }
    return "";
  });

  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [quests, setQuests] = useState<QuestResponse[]>([]);
  const [activeQuest, setActiveQuest] = useState<QuestResponse | null>(null);

  // Loading and error states
  const [loading, setLoading] = useState<boolean>(true);
  const [serverError, setServerError] = useState<string | null>(null);

  // Modals
  const [setupModalOpen, setSetupModalOpen] = useState<boolean>(false);
  const [verifyModalOpen, setVerifyModalOpen] = useState<boolean>(false);
  const [userModalOpen, setUserModalOpen] = useState<boolean>(false);
  const [completeResult, setCompleteResult] = useState<QuestVerificationResponse | null>(null);

  // Manual refresh callback
  const refreshData = useCallback(async (targetUserId?: string) => {
    const idToFetch = targetUserId || userId || getActiveUserId();
    if (!idToFetch) return;

    setLoading(true);
    setServerError(null);

    try {
      const [profileRes, questsRes] = await Promise.allSettled([
        api.getProfile(idToFetch),
        api.getUserQuests(idToFetch),
      ]);

      if (profileRes.status === "fulfilled") {
        setProfile(profileRes.value);
      } else {
        setProfile(null);
      }

      if (questsRes.status === "fulfilled") {
        const sorted = [...questsRes.value].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        setQuests(sorted);
        setActiveQuest((prev) => (prev ? sorted.find((q) => q.id === prev.id) || prev : null));
      } else {
        setQuests([]);
      }
    } catch (err: unknown) {
      setServerError(
        (err as Error)?.message ||
          "Unable to connect to WAYBOUND backend server. Please verify FastAPI is running at http://localhost:8000."
      );
    } finally {
      setLoading(false);
    }
  }, [userId]);

  // Initial fetch on mount & identity change
  useEffect(() => {
    let isMounted = true;
    const currentId = userId || getActiveUserId();
    if (!currentId) return;

    async function fetchInitial() {
      try {
        const [profileRes, questsRes] = await Promise.allSettled([
          api.getProfile(currentId),
          api.getUserQuests(currentId),
        ]);

        if (!isMounted) return;

        if (profileRes.status === "fulfilled") {
          setProfile(profileRes.value);
        } else {
          setProfile(null);
        }

        if (questsRes.status === "fulfilled") {
          const sorted = [...questsRes.value].sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          );
          setQuests(sorted);
          setActiveQuest((prev) => (prev ? sorted.find((q) => q.id === prev.id) || prev : null));
        } else {
          setQuests([]);
        }
      } catch (err: unknown) {
        if (isMounted) {
          setServerError(
            (err as Error)?.message ||
              "Unable to connect to WAYBOUND backend server. Please verify FastAPI is running at http://localhost:8000."
          );
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    void fetchInitial();

    return () => {
      isMounted = false;
    };
  }, [userId]);

  // Handle Quest Generation
  async function handleGenerateQuest(payload: QuestCreateRequest) {
    const newQuest = await api.generateQuest(payload);
    setActiveQuest(newQuest);
    await refreshData(userId);
  }

  // Handle Start Quest (draft -> active)
  async function handleStartQuest(questId: string) {
    const started = await api.startQuest(questId);
    setActiveQuest(started);
    await refreshData(userId);
  }

  // Handle Unlock Next Clue
  async function handleUnlockHint(questId: string) {
    const res = await api.unlockHint(questId);
    setActiveQuest(res.quest);
    await refreshData(userId);
  }

  // Handle Abandon Quest
  async function handleAbandonQuest(questId: string) {
    await api.abandonQuest(questId);
    setActiveQuest(null);
    await refreshData(userId);
  }

  // Handle Verify Quest
  async function handleVerifyQuest(payload: QuestVerifyRequest): Promise<QuestVerificationResponse> {
    if (!activeQuest) {
      throw new Error("No active quest selected for verification.");
    }
    return api.verifyQuest(activeQuest.id, payload);
  }

  // Handle Successful Verification
  function handleVerificationSuccess(result: QuestVerificationResponse) {
    setActiveQuest(result.quest);
    setCompleteResult(result);
    void refreshData(userId);
  }

  return (
    <div className="flex flex-col min-h-screen">
      {/* Sticky Header */}
      <Header
        profile={profile}
        loading={loading}
        onRefresh={() => void refreshData(userId)}
        onOpenUserModal={() => setUserModalOpen(true)}
      />

      {/* Main Content Area */}
      <main className="flex-1 w-full max-w-md sm:max-w-lg mx-auto px-4 py-5 space-y-5">
        {/* Connection Error Banner */}
        {serverError && (
          <div className="rounded-2xl bg-red-950/60 border border-red-800/70 p-4 space-y-2">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-xs font-bold text-red-200">Backend Server Connection Issue</p>
                <p className="text-xs text-red-300/80 leading-relaxed">{serverError}</p>
              </div>
            </div>
            <button
              onClick={() => void refreshData(userId)}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-red-900/40 border border-red-700/50 py-2 text-xs font-semibold text-red-200 hover:bg-red-800/40 transition"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>Retry Connection</span>
            </button>
          </div>
        )}

        {/* View Switch: Active Quest View OR Dashboard */}
        {activeQuest ? (
          <ActiveQuestView
            quest={activeQuest}
            onBack={() => setActiveQuest(null)}
            onStartQuest={handleStartQuest}
            onUnlockHint={handleUnlockHint}
            onOpenVerify={() => setVerifyModalOpen(true)}
            onAbandonQuest={handleAbandonQuest}
          />
        ) : (
          <div className="space-y-5 animate-in fade-in duration-200">
            {/* Explorer Profile Card */}
            <ProfileCard
              profile={profile}
              loading={loading}
              onBeginAdventure={() => setSetupModalOpen(true)}
              onSelectUser={() => setUserModalOpen(true)}
            />

            {/* Quest History Journal */}
            <QuestHistoryCard
              quests={quests}
              loading={loading}
              onSelectQuest={(quest) => setActiveQuest(quest)}
            />
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="w-full border-t border-purple-950/60 py-4 text-center text-[11px] text-purple-400/50">
        <div className="flex items-center justify-center gap-1.5">
          <Compass className="h-3.5 w-3.5 text-amber-500/60" />
          <span>WAYBOUND • AI-Powered Mystery Exploration • Google Places & Gemma AI</span>
        </div>
      </footer>

      {/* Modals */}
      <QuestSetupModal
        userId={userId}
        isOpen={setupModalOpen}
        onClose={() => setSetupModalOpen(false)}
        onSubmit={handleGenerateQuest}
      />

      {activeQuest && (
        <QuestVerifyModal
          quest={activeQuest}
          isOpen={verifyModalOpen}
          onClose={() => setVerifyModalOpen(false)}
          onVerify={handleVerifyQuest}
          onSuccess={handleVerificationSuccess}
        />
      )}

      <QuestCompleteModal
        result={completeResult}
        isOpen={!!completeResult}
        onClose={() => {
          setCompleteResult(null);
          setActiveQuest(null);
        }}
      />

      <UserModal
        isOpen={userModalOpen}
        onClose={() => setUserModalOpen(false)}
        onUserChanged={(newId) => {
          setUserId(newId);
          void refreshData(newId);
        }}
      />
    </div>
  );
}
