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
import {
  api,
  ApiError,
  getActiveUserId,
  getSavedActiveQuestId,
  setSavedActiveQuestId,
} from "@/lib/api";
import type {
  ProfileResponse,
  QuestCreateRequest,
  QuestResponse,
  QuestVerificationResponse,
  QuestVerifyRequest,
} from "@/types/api";
import { AlertTriangle, RefreshCw, Compass, UserX, AlertCircle } from "lucide-react";

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

  // Loading and fine-grained error states
  const [loading, setLoading] = useState<boolean>(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [userNotFoundError, setUserNotFoundError] = useState<boolean>(false);
  const [questsError, setQuestsError] = useState<string | null>(null);

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
    setConnectionError(null);
    setUserNotFoundError(false);
    setQuestsError(null);

    try {
      const [profileRes, questsRes] = await Promise.allSettled([
        api.getProfile(idToFetch),
        api.getUserQuests(idToFetch),
      ]);

      let isConnError = false;

      // Handle Profile Result
      if (profileRes.status === "fulfilled") {
        setProfile(profileRes.value);
        setUserNotFoundError(false);
      } else {
        const err = profileRes.reason;
        if (err instanceof ApiError && err.status === 404) {
          setUserNotFoundError(true);
          setProfile(null);
        } else if (err instanceof ApiError && (err.status === 0 || err.status === 408 || err.status >= 500)) {
          isConnError = true;
          setConnectionError(
            err.message || "Failed to connect to WAYBOUND backend server (http://localhost:8000)."
          );
        } else {
          setProfile(null);
        }
      }

      // Handle Quests Result
      if (questsRes.status === "fulfilled") {
        const sorted = [...questsRes.value].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        setQuests(sorted);
        setQuestsError(null);

        // Synchronize active quest without mutating its state
        setActiveQuest((prev) => {
          if (!prev) return null;
          return sorted.find((q) => q.id === prev.id) || prev;
        });
      } else {
        const err = questsRes.reason;
        if (err instanceof ApiError && err.status === 404) {
          // User not found in quest history
          setQuests([]);
        } else if (err instanceof ApiError && (err.status === 0 || err.status === 408 || err.status >= 500)) {
          if (!isConnError) {
            // Profile succeeded, but quests failed due to server/network
            setQuestsError("Could not load quest history from the server. Your explorer profile was preserved.");
          }
        } else {
          setQuestsError("Failed to fetch quest history.");
        }
      }
    } catch (err: unknown) {
      setConnectionError((err as Error)?.message || "Unexpected error communicating with backend.");
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

        let isConnError = false;

        // 1. Process profile
        if (profileRes.status === "fulfilled") {
          setProfile(profileRes.value);
          setUserNotFoundError(false);
        } else {
          const err = profileRes.reason;
          if (err instanceof ApiError && err.status === 404) {
            setUserNotFoundError(true);
            setProfile(null);
          } else if (err instanceof ApiError && (err.status === 0 || err.status === 408 || err.status >= 500)) {
            isConnError = true;
            setConnectionError(
              err.message || "Failed to connect to WAYBOUND backend server (http://localhost:8000)."
            );
          } else {
            setProfile(null);
          }
        }

        // 2. Process quests
        let loadedQuests: QuestResponse[] = [];
        if (questsRes.status === "fulfilled") {
          loadedQuests = [...questsRes.value].sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          );
          setQuests(loadedQuests);
          setQuestsError(null);
        } else {
          const err = questsRes.reason;
          if (err instanceof ApiError && err.status === 404) {
            setQuests([]);
          } else if (err instanceof ApiError && (err.status === 0 || err.status === 408 || err.status >= 500)) {
            if (!isConnError) {
              setQuestsError("Could not load quest history from server. Explorer profile was preserved.");
            }
          }
        }

        // 3. RESTORE DRAFT / ACTIVE QUEST ON REFRESH WITHOUT AUTOMATICALLY RESTARTING OR MUTATING IT
        const savedQuestId = getSavedActiveQuestId();
        if (savedQuestId) {
          const existingInList = loadedQuests.find((q) => q.id === savedQuestId);
          if (existingInList && (existingInList.status === "draft" || existingInList.status === "active")) {
            // Restore existing quest state as-is
            setActiveQuest(existingInList);
          } else {
            // Fetch directly from server if not found in first page or verify status
            try {
              const freshQuest = await api.getQuest(savedQuestId);
              if (isMounted && (freshQuest.status === "draft" || freshQuest.status === "active")) {
                setActiveQuest(freshQuest);
              } else {
                setSavedActiveQuestId(null);
              }
            } catch {
              setSavedActiveQuestId(null);
            }
          }
        }
      } catch (err: unknown) {
        if (isMounted) {
          setConnectionError(
            (err as Error)?.message || "Unable to connect to WAYBOUND backend server."
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
    setSavedActiveQuestId(newQuest.id);
    await refreshData(userId);
  }

  // Handle Start Quest (draft -> active)
  async function handleStartQuest(questId: string) {
    const started = await api.startQuest(questId);
    setActiveQuest(started);
    setSavedActiveQuestId(started.id);
    await refreshData(userId);
  }

  // Handle Unlock Next Clue
  async function handleUnlockHint(questId: string) {
    const res = await api.unlockHint(questId);
    setActiveQuest(res.quest);
    setSavedActiveQuestId(res.quest.id);
    await refreshData(userId);
  }

  // Handle Abandon Quest
  async function handleAbandonQuest(questId: string) {
    await api.abandonQuest(questId);
    setActiveQuest(null);
    setSavedActiveQuestId(null);
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
    setSavedActiveQuestId(null); // Quest is completed, clear active storage
    setCompleteResult(result);
    void refreshData(userId);
  }

  function handleSelectQuestFromJournal(quest: QuestResponse) {
    setActiveQuest(quest);
    if (quest.status === "draft" || quest.status === "active") {
      setSavedActiveQuestId(quest.id);
    } else {
      setSavedActiveQuestId(null);
    }
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
        {/* 1. Backend Connection Error Banner */}
        {connectionError && (
          <div className="rounded-2xl bg-red-950/60 border border-red-800/70 p-4 space-y-2.5 animate-in fade-in">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-xs font-bold text-red-200">Backend Server Unreachable</p>
                <p className="text-xs text-red-300/80 leading-relaxed">{connectionError}</p>
                <p className="text-[11px] text-red-400/80">
                  Ensure FastAPI is running: <code>uvicorn app.main:app --port 8000</code>
                </p>
              </div>
            </div>
            <button
              onClick={() => void refreshData(userId)}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-red-900/40 border border-red-700/50 py-2 text-xs font-semibold text-red-200 hover:bg-red-800/40 transition cursor-pointer"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>Retry Server Connection</span>
            </button>
          </div>
        )}

        {/* 2. Missing Demo User Banner (Clear distinction from network error) */}
        {userNotFoundError && !connectionError && (
          <div className="rounded-2xl bg-amber-950/50 border border-amber-600/60 p-4 space-y-3 animate-in fade-in">
            <div className="flex items-start gap-2.5">
              <UserX className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-xs font-bold text-amber-200">Explorer User Not Found in Database</p>
                <p className="text-xs text-amber-300/80 leading-relaxed">
                  Explorer ID <code>{userId}</code> does not exist in the database.
                </p>
                <p className="text-[11px] text-amber-400/80">
                  Run <code>PYTHONPATH=. .venv/bin/python3 scripts/seed_demo_user.py</code> or switch identity.
                </p>
              </div>
            </div>
            <button
              onClick={() => setUserModalOpen(true)}
              className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-amber-500/60 bg-amber-500/20 py-2.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/30 transition cursor-pointer"
            >
              <span>Switch or Configure Explorer ID</span>
            </button>
          </div>
        )}

        {/* 3. Partial Failure Warning: Quests Error while Profile Loaded */}
        {questsError && !connectionError && (
          <div className="rounded-xl bg-purple-950/40 border border-purple-800/60 p-3 text-xs text-purple-200 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-purple-400 shrink-0" />
              <span>{questsError}</span>
            </div>
            <button
              onClick={() => void refreshData(userId)}
              className="text-amber-300 hover:underline shrink-0 font-medium text-[11px]"
            >
              Retry
            </button>
          </div>
        )}

        {/* View Switch: Active Quest View OR Dashboard */}
        {activeQuest ? (
          <ActiveQuestView
            quest={activeQuest}
            onBack={() => {
              setActiveQuest(null);
              setSavedActiveQuestId(null);
            }}
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

            {/* Quest History Journal (Handles legitimate empty history gracefully) */}
            <QuestHistoryCard
              quests={quests}
              loading={loading}
              onSelectQuest={handleSelectQuestFromJournal}
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
          setSavedActiveQuestId(null);
        }}
      />

      <UserModal
        isOpen={userModalOpen}
        onClose={() => setUserModalOpen(false)}
        onUserChanged={(newId) => {
          setUserId(newId);
          setSavedActiveQuestId(null);
          void refreshData(newId);
        }}
      />
    </div>
  );
}
