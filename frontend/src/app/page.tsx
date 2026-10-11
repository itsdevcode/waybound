"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { Header } from "@/components/Header";
import { ProfileCard } from "@/components/ProfileCard";
import { QuestHistoryCard } from "@/components/QuestHistoryCard";
import { QuestSetupModal } from "@/components/QuestSetupModal";
import { ActiveQuestView } from "@/components/ActiveQuestView";
import { QuestVerifyModal } from "@/components/QuestVerifyModal";
import { QuestCompleteModal } from "@/components/QuestCompleteModal";
import { UserModal } from "@/components/UserModal";
import { PartyLobbyView } from "@/components/PartyLobbyView";
import { CoopQuestView } from "@/components/CoopQuestView";
import {
  api,
  ApiError,
  getActiveUserId,
  getAuthToken,
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
import type {
  PartyResponse,
  PartyCreateRequest,
  PartyJoinRequest,
  PartyStartQuestRequest,
  SharedPartyQuestResponse,
  PartyVerificationResponse,
} from "@/types/party";
import {
  AlertTriangle,
  RefreshCw,
  Compass,
  UserX,
  AlertCircle,
  Users,
} from "lucide-react";

export default function HomePage() {
  const [userId, setUserId] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return getActiveUserId();
    }
    return "";
  });

  // Mode: Solo Expedition vs Mystery Fellowship (2-Player)
  const [mode, setMode] = useState<"solo" | "coop">("solo");

  // Solo State
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [quests, setQuests] = useState<QuestResponse[]>([]);
  const [activeQuest, setActiveQuest] = useState<QuestResponse | null>(null);

  // Cooperative / Party State
  const [party, setParty] = useState<PartyResponse | null>(null);
  const [myParties, setMyParties] = useState<PartyResponse[]>([]);
  const [coopQuest, setCoopQuest] = useState<SharedPartyQuestResponse | null>(null);
  const [viewingCoopQuest, setViewingCoopQuest] = useState<boolean>(false);

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

  // Ref to track active party for polling without stale closure
  const activePartyIdRef = useRef<string | null>(null);
  useEffect(() => {
    activePartyIdRef.current = party?.id || null;
  }, [party]);

  // Ensure authenticated session and refresh parties
  const syncPartyData = useCallback(async () => {
    try {
      // 1. Establish verified session token without exchanging arbitrary user IDs
      if (!getAuthToken()) {
        try {
          await api.auth.loginDemo();
        } catch {
          // If in production or demo auth is disabled, user must log in via OTP
          return;
        }
      }

      // 2. Fetch explorer's fellowships
      const partiesList = await api.parties.listMine();
      setMyParties(partiesList);

      // 3. Check if there's an ongoing party
      const currentActive = partiesList.find(
        (p) => p.status === "open" || p.status === "active"
      );

      if (currentActive) {
        setParty(currentActive);
        if (currentActive.has_active_quest) {
          try {
            const sharedQ = await api.parties.getSharedQuest(currentActive.id);
            setCoopQuest(sharedQ);
          } catch {
            setCoopQuest(null);
          }
        } else {
          setCoopQuest(null);
          setViewingCoopQuest(false);
        }
      } else {
        setParty(null);
        setCoopQuest(null);
        setViewingCoopQuest(false);
      }
    } catch {
      // Silently handle if party service is not initialized yet
    }
  }, []);

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
          setQuests([]);
        } else if (err instanceof ApiError && (err.status === 0 || err.status === 408 || err.status >= 500)) {
          if (!isConnError) {
            setQuestsError("Could not load quest history from the server. Your explorer profile was preserved.");
          }
        } else {
          setQuestsError("Failed to fetch quest history.");
        }
      }

      // Sync party state
      await syncPartyData();
    } catch (err: unknown) {
      setConnectionError((err as Error)?.message || "Unexpected error communicating with backend.");
    } finally {
      setLoading(false);
    }
  }, [userId, syncPartyData]);

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

        // 3. Restore draft/active solo quest on refresh
        const savedQuestId = getSavedActiveQuestId();
        if (savedQuestId) {
          const existingInList = loadedQuests.find((q) => q.id === savedQuestId);
          if (existingInList && (existingInList.status === "draft" || existingInList.status === "active")) {
            setActiveQuest(existingInList);
          } else {
            try {
              const freshQuest = await api.getQuest(savedQuestId);
              if (isMounted && (freshQuest.status === "draft" || freshQuest.status === "active")) {
                setActiveQuest(freshQuest);
              }
            } catch {
              setSavedActiveQuestId(null);
            }
          }
        }

        // 4. Sync party data
        await syncPartyData();
      } catch (err: unknown) {
        if (isMounted) {
          setConnectionError((err as Error)?.message || "Failed to communicate with backend.");
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
  }, [userId, syncPartyData]);

  // Periodic polling for party mode (every 4 seconds) to detect partner joining/verifying
  useEffect(() => {
    if (mode !== "coop" || !party) return;

    const intervalId = setInterval(async () => {
      try {
        const partyId = activePartyIdRef.current;
        if (!partyId) return;

        const updatedParty = await api.parties.get(partyId);
        setParty(updatedParty);

        if (updatedParty.has_active_quest) {
          const sharedQ = await api.parties.getSharedQuest(partyId);
          setCoopQuest(sharedQ);
        }
      } catch {
        // Ignore background polling glitches
      }
    }, 4000);

    return () => clearInterval(intervalId);
  }, [mode, party]);

  // Solo quest handlers
  async function handleGenerateQuest(payload: QuestCreateRequest) {
    const generated = await api.generateQuest(payload);
    setActiveQuest(generated);
    setSavedActiveQuestId(generated.id);
    void refreshData(userId);
  }

  async function handleStartQuest(questId: string) {
    const started = await api.startQuest(questId);
    setActiveQuest(started);
    setSavedActiveQuestId(started.id);
    void refreshData(userId);
  }

  async function handleUnlockHint(questId: string) {
    const res = await api.unlockHint(questId);
    setActiveQuest(res.quest);
  }

  async function handleVerifyQuest(questId: string, payload: QuestVerifyRequest) {
    return api.verifyQuest(questId, payload);
  }

  function handleVerificationSuccess(res: QuestVerificationResponse) {
    setCompleteResult(res);
    setActiveQuest(res.quest);
    setSavedActiveQuestId(null);
    void refreshData(userId);
  }

  async function handleAbandonQuest(questId: string) {
    const abandoned = await api.abandonQuest(questId);
    setActiveQuest(abandoned);
    setSavedActiveQuestId(null);
    void refreshData(userId);
  }

  function handleSelectQuestFromJournal(q: QuestResponse) {
    setActiveQuest(q);
    if (q.status === "draft" || q.status === "active") {
      setSavedActiveQuestId(q.id);
    } else {
      setSavedActiveQuestId(null);
    }
  }

  // Party handlers
  async function handleCreateParty(payload: PartyCreateRequest) {
    const newParty = await api.parties.create(payload);
    setParty(newParty);
    setCoopQuest(null);
    setViewingCoopQuest(false);
    void syncPartyData();
    return newParty;
  }

  async function handleJoinParty(payload: PartyJoinRequest) {
    const joined = await api.parties.join(payload);
    setParty(joined);
    setCoopQuest(null);
    setViewingCoopQuest(false);
    void syncPartyData();
    return joined;
  }

  async function handleLeaveParty(partyId: string) {
    await api.parties.leave(partyId);
    setParty(null);
    setCoopQuest(null);
    setViewingCoopQuest(false);
    void syncPartyData();
  }

  async function handleDisbandParty(partyId: string) {
    await api.parties.disband(partyId);
    setParty(null);
    setCoopQuest(null);
    setViewingCoopQuest(false);
    void syncPartyData();
  }

  async function handleSetConsent(partyId: string, consent: boolean) {
    const updated = await api.parties.setConsent(partyId, consent);
    setParty(updated);
  }

  async function handleStartPartyQuest(partyId: string, payload: PartyStartQuestRequest) {
    const started = await api.parties.startQuest(partyId, payload);
    setCoopQuest(started);
    setViewingCoopQuest(true);
    const updatedParty = await api.parties.get(partyId);
    setParty(updatedParty);
  }

  async function handleUnlockPartyClue(partyId: string, clueId: string) {
    const updated = await api.parties.unlockClue(partyId, clueId);
    setCoopQuest(updated);
  }

  async function handleVerifyPartyArrival(
    partyId: string,
    coords: { latitude: number; longitude: number },
    answer: string
  ): Promise<PartyVerificationResponse> {
    const res = await api.parties.verifyArrival(partyId, {
      latitude: coords.latitude,
      longitude: coords.longitude,
      observation_answer: answer,
    });
    // refresh party quest
    const updated = await api.parties.getSharedQuest(partyId);
    setCoopQuest(updated);
    void refreshData(userId);
    return res;
  }

  const isHost = party ? party.host_id === userId : false;

  return (
    <div className="min-h-screen bg-[#07040d] text-purple-100 flex flex-col font-sans selection:bg-amber-500/30 selection:text-amber-200">
      {/* Top Header */}
      <Header
        profile={profile}
        loading={loading}
        onRefresh={() => void refreshData(userId)}
        onOpenUserModal={() => setUserModalOpen(true)}
      />

      {/* Main Content Area */}
      <main className="flex-1 w-full max-w-md sm:max-w-lg mx-auto px-4 py-4 space-y-4">
        {/* Mode Switch: Solo Expedition vs Mystery Fellowship */}
        <div className="flex rounded-xl bg-purple-950/60 p-1 border border-purple-900/60 text-xs shadow-md">
          <button
            onClick={() => setMode("solo")}
            className={`flex-1 py-2 rounded-lg font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
              mode === "solo"
                ? "bg-gradient-to-r from-purple-800 to-purple-900 text-amber-300 shadow border border-purple-700/60"
                : "text-purple-400 hover:text-purple-200"
            }`}
          >
            <Compass className="h-3.5 w-3.5 text-amber-400" />
            <span>Solo Expedition</span>
          </button>
          <button
            onClick={() => setMode("coop")}
            className={`flex-1 py-2 rounded-lg font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
              mode === "coop"
                ? "bg-gradient-to-r from-purple-800 to-purple-900 text-amber-300 shadow border border-purple-700/60"
                : "text-purple-400 hover:text-purple-200"
            }`}
          >
            <Users className="h-3.5 w-3.5 text-amber-400" />
            <span>Mystery Fellowship</span>
          </button>
        </div>

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

        {/* 2. Missing Demo User Banner */}
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

        {/* 3. Partial Failure Warning: Quests Error */}
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

        {/* --- VIEW SWITCHER --- */}
        {mode === "coop" ? (
          viewingCoopQuest && coopQuest && party ? (
            <CoopQuestView
              partyId={party.id}
              quest={coopQuest}
              onBack={() => setViewingCoopQuest(false)}
              onRefresh={async () => {
                if (!party) return;
                const freshParty = await api.parties.get(party.id);
                setParty(freshParty);
                if (freshParty.has_active_quest) {
                  const freshQuest = await api.parties.getSharedQuest(party.id);
                  setCoopQuest(freshQuest);
                }
              }}
              onUnlockClue={handleUnlockPartyClue}
              onVerifyArrival={handleVerifyPartyArrival}
              onLeaveParty={handleLeaveParty}
              onDisbandParty={handleDisbandParty}
              isHost={isHost}
            />
          ) : (
            <PartyLobbyView
              currentUserId={userId}
              party={party}
              onRefreshParty={async () => {
                if (!party) return;
                const fresh = await api.parties.get(party.id);
                setParty(fresh);
                if (fresh.has_active_quest) {
                  const freshQ = await api.parties.getSharedQuest(fresh.id);
                  setCoopQuest(freshQ);
                }
              }}
              onCreateParty={handleCreateParty}
              onJoinParty={handleJoinParty}
              onLeaveParty={handleLeaveParty}
              onDisbandParty={handleDisbandParty}
              onSetConsent={handleSetConsent}
              onStartQuest={handleStartPartyQuest}
              onOpenQuest={() => setViewingCoopQuest(true)}
              myParties={myParties}
              onSelectParty={async (pId) => {
                const selected = await api.parties.get(pId);
                setParty(selected);
                if (selected.has_active_quest) {
                  const q = await api.parties.getSharedQuest(pId);
                  setCoopQuest(q);
                  setViewingCoopQuest(true);
                }
              }}
            />
          )
        ) : activeQuest ? (
          /* Solo Active Quest View */
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
          /* Solo Dashboard */
          <div className="space-y-5 animate-in fade-in duration-200">
            <ProfileCard
              profile={profile}
              loading={loading}
              onBeginAdventure={() => setSetupModalOpen(true)}
              onSelectUser={() => setUserModalOpen(true)}
            />

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

      {/* Solo Modals */}
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
          onVerify={(payload) => handleVerifyQuest(activeQuest.id, payload)}
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
