"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import { Header } from "@/components/Header";
import { QuestSetupModal } from "@/components/QuestSetupModal";
import { ActiveQuestView } from "@/components/ActiveQuestView";
import { QuestVerifyModal } from "@/components/QuestVerifyModal";
import { QuestCompleteModal } from "@/components/QuestCompleteModal";
import { AuthModal } from "@/components/AuthModal";
import { PartyLobbyView } from "@/components/PartyLobbyView";
import { CoopQuestView } from "@/components/CoopQuestView";
import { GoogleMapView, type CalculatedRouteInfo } from "@/components/GoogleMapView";
import { RadarMapView } from "@/components/RadarMapView";
import {
  api,
  ApiError,
  getActiveUserId,
  setActiveUserId,
  getAuthToken,
  removeAuthToken,
  getSavedActiveQuestId,
  setSavedActiveQuestId,
} from "@/lib/api";
import type {
  ProfileResponse,
  QuestCreateRequest,
  QuestResponse,
  QuestVerificationResponse,
  QuestVerifyRequest,
  NearbyQuestItem,
  ExplorerType,
  DifficultyType,
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
  useGoogleMaps,
  reverseGeocodeCoordinates,
  estimateWalkingMinutes,
  getGoogleMapsNavigationUrl,
} from "@/lib/maps";
import {
  getCurrentCoordinates,
  watchCoordinates,
} from "@/lib/geo";
import { getXpProgress, formatDate } from "@/lib/utils";
import {
  Compass,
  Users,
  Search,
  Sparkles,
  Trophy,
  Navigation,
  Crosshair,
  ExternalLink,
  Shield,
  Clock,
  MapPin,
  Play,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Map as MapIcon,
  User,
  Radio,
  AlertTriangle,
  RotateCw,
  X,
  ListOrdered,
  Plus,
  Minus,
} from "lucide-react";

const RADIUS_OPTIONS = [
  { label: "500m", value: 500 },
  { label: "1 km", value: 1000 },
  { label: "2 km", value: 2000 },
  { label: "5 km", value: 5000 },
];

export default function HomePage() {
  const { isReady: isGoogleMapsReady } = useGoogleMaps();

  const [userId, setUserId] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return getActiveUserId();
    }
    return "";
  });
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);

  // Tabs: "solo" vs "coop"
  const [mode, setMode] = useState<"solo" | "coop">("solo");

  // Mobile Bottom Nav Tab
  const [mobileTab, setMobileTab] = useState<"map" | "quests" | "partners" | "profile">("map");
  const [mobileSheetOpen, setMobileSheetOpen] = useState<boolean>(false);

  // Profile & Quests State
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [quests, setQuests] = useState<QuestResponse[]>([]);
  const [activeQuest, setActiveQuest] = useState<QuestResponse | null>(null);

  // Party State
  const [party, setParty] = useState<PartyResponse | null>(null);
  const [myParties, setMyParties] = useState<PartyResponse[]>([]);
  const [coopQuest, setCoopQuest] = useState<SharedPartyQuestResponse | null>(null);
  const [viewingCoopQuest, setViewingCoopQuest] = useState<boolean>(false);

  // Loading & Connection
  const [loading, setLoading] = useState<boolean>(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // Location State
  const [userLocation, setUserLocation] = useState<{
    latitude: number;
    longitude: number;
    accuracy: number;
    isManual: boolean;
  } | null>(null);
  const [addressLabel, setAddressLabel] = useState<string>("Locating explorer...");
  const [geoLoading, setGeoLoading] = useState<boolean>(false);
  const [showCityPicker, setShowCityPicker] = useState<boolean>(false);

  // Map Controls State
  const [radiusMeters, setRadiusMeters] = useState<number>(1000);
  const [nearbyQuests, setNearbyQuests] = useState<NearbyQuestItem[]>([]);
  const [loadingNearby, setLoadingNearby] = useState<boolean>(false);
  const [selectedQuestItem, setSelectedQuestItem] = useState<NearbyQuestItem | null>(null);
  const [routeInfo, setRouteInfo] = useState<CalculatedRouteInfo | null>(null);
  const [showDirectionsModal, setShowDirectionsModal] = useState<boolean>(false);

  // Search & Filter state for quests list
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [difficultyFilter, setDifficultyFilter] = useState<string>("all");

  // Modals
  const [setupModalOpen, setSetupModalOpen] = useState<boolean>(false);
  const [verifyModalOpen, setVerifyModalOpen] = useState<boolean>(false);
  const [authModalOpen, setAuthModalOpen] = useState<boolean>(false);
  const [completeResult, setCompleteResult] = useState<QuestVerificationResponse | null>(null);
  const [pendingQuestPayload, setPendingQuestPayload] = useState<QuestCreateRequest | null>(null);

  // Acquire Browser GPS
  const acquireLocation = useCallback(async () => {
    setGeoLoading(true);
    try {
      const coords = await getCurrentCoordinates();
      setUserLocation({
        latitude: coords.latitude,
        longitude: coords.longitude,
        accuracy: coords.accuracy,
        isManual: false,
      });
      const addr = await reverseGeocodeCoordinates(coords.latitude, coords.longitude);
      setAddressLabel(addr || "Verified GPS Location");
    } catch {
      if (!userLocation) {
        setAddressLabel("GPS unavailable — Select city or retry");
      }
    } finally {
      setGeoLoading(false);
    }
  }, [userLocation]);

  // Initial Location
  useEffect(() => {
    if (userLocation) return;
    const timer = setTimeout(() => {
      void acquireLocation();
    }, 0);
    return () => clearTimeout(timer);
  }, [userLocation, acquireLocation]);

  // Continuous Live GPS Tracking as explorer walks in the real world
  useEffect(() => {
    if (!userLocation || userLocation.isManual) return;
    const cleanup = watchCoordinates(
      (freshCoords) => {
        setUserLocation((prev) => {
          if (!prev || prev.isManual) return prev;
          return {
            latitude: freshCoords.latitude,
            longitude: freshCoords.longitude,
            accuracy: freshCoords.accuracy,
            isManual: false,
          };
        });
      },
      (geoErr) => {
        console.warn("Real-time GPS update notice:", geoErr.message);
      }
    );
    return cleanup;
  }, [userLocation?.isManual]);

  // Fetch Nearby Quests on location or radius change
  const fetchNearby = useCallback(async () => {
    if (!userLocation) return;
    setLoadingNearby(true);
    try {
      const res = await api.getNearbyQuests(
        userLocation.latitude,
        userLocation.longitude,
        radiusMeters
      );
      setNearbyQuests(res.items);

      // Default selection to active quest if present, else nearest available
      const activeItem = res.items.find((item) => item.status === "active");
      if (activeItem) {
        setSelectedQuestItem(activeItem);
      } else if (res.items.length > 0 && !selectedQuestItem) {
        setSelectedQuestItem(res.items[0]);
      }
    } catch (err) {
      console.warn("Could not load nearby quests:", err);
    } finally {
      setLoadingNearby(false);
    }
  }, [userLocation, radiusMeters, selectedQuestItem]);

  useEffect(() => {
    if (!userLocation) return;
    const timer = setTimeout(() => {
      void fetchNearby();
    }, 0);
    return () => clearTimeout(timer);
  }, [userLocation, radiusMeters, fetchNearby]);

  // Sync Party data
  const syncPartyData = useCallback(async () => {
    try {
      if (!getAuthToken()) {
        setMyParties([]);
        setParty(null);
        setCoopQuest(null);
        setViewingCoopQuest(false);
        return;
      }

      const partiesList = await api.parties.listMine();
      setMyParties(partiesList);

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
      // Ignore background sync errors
    }
  }, []);

  // Refresh data callback
  const refreshData = useCallback(async (targetUserId?: string) => {
    setLoading(true);
    setConnectionError(null);

    try {
      const token = getAuthToken();
      let profilePromise: Promise<ProfileResponse>;
      let questsPromise: Promise<QuestResponse[]>;

      if (token) {
        profilePromise = api.getMyProfile();
        questsPromise = api.getMyQuests();
      } else {
        const idToFetch = targetUserId || userId || getActiveUserId();
        profilePromise = api.getProfile(idToFetch);
        questsPromise = api.getUserQuests(idToFetch);
      }

      const [profileRes, questsRes] = await Promise.allSettled([
        profilePromise,
        questsPromise,
      ]);

      if (profileRes.status === "fulfilled") {
        setProfile(profileRes.value);
        if (profileRes.value.user_id) {
          setUserId(profileRes.value.user_id);
          setActiveUserId(profileRes.value.user_id);
        }
      } else {
        const err = profileRes.reason;
        if (err instanceof ApiError && (err.status === 404 || err.status === 401)) {
          setProfile(null);
        } else if (err instanceof ApiError && (err.status === 0 || err.status === 408 || err.status >= 500)) {
          setConnectionError(err.message || "Cannot connect to WAYBOUND backend.");
        }
      }

      if (questsRes.status === "fulfilled") {
        const sorted = [...questsRes.value].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        setQuests(sorted);
        setActiveQuest((prev) => (prev ? sorted.find((q) => q.id === prev.id) || prev : null));
      }

      await syncPartyData();
      await fetchNearby();
    } catch (err: unknown) {
      setConnectionError((err as Error)?.message || "Network error");
    } finally {
      setLoading(false);
    }
  }, [userId, syncPartyData, fetchNearby]);

  // Initial mount load
  useEffect(() => {
    let isMounted = true;
    async function init() {
      try {
        const token = getAuthToken();
        if (token) {
          try {
            const me = await api.auth.getMe();
            if (isMounted && me?.email) setCurrentUserEmail(me.email);
          } catch {}
        }
        await refreshData();

        const savedId = getSavedActiveQuestId();
        if (savedId && isMounted) {
          try {
            const q = await api.getQuest(savedId);
            if (q.status === "draft" || q.status === "active") {
              setActiveQuest(q);
            }
          } catch {}
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    void init();
    return () => {
      isMounted = false;
    };
  }, [refreshData]);

  // Solo Quest Actions
  async function handleGenerateQuest(payload: QuestCreateRequest) {
    const lat = payload.latitude ?? userLocation?.latitude ?? null;
    const lon = payload.longitude ?? userLocation?.longitude ?? null;
    const finalPayload: QuestCreateRequest = { ...payload, latitude: lat, longitude: lon };

    if (!getAuthToken()) {
      setPendingQuestPayload(finalPayload);
      setSetupModalOpen(false);
      setAuthModalOpen(true);
      return;
    }

    try {
      const generated = await api.generateQuest(finalPayload);
      setActiveQuest(generated);
      setSavedActiveQuestId(generated.id);
      setPendingQuestPayload(null);
      void refreshData(userId);
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 401) {
        setPendingQuestPayload(finalPayload);
        setSetupModalOpen(false);
        setAuthModalOpen(true);
        return;
      }
      throw err;
    }
  }

  async function handleStartQuest(questId: string) {
    const started = await api.startQuest(questId);
    setActiveQuest(started);
    setSavedActiveQuestId(started.id);
    void refreshData(userId);
  }

  async function handleStartAdventure(item: NearbyQuestItem) {
    if (item.id) {
      if (item.status === "active" || item.status === "completed") {
        try {
          const q = await api.getQuest(item.id);
          setActiveQuest(q);
          if (q.status === "active") setSavedActiveQuestId(q.id);
        } catch {}
        return;
      }
      await handleStartQuest(item.id);
      return;
    }

    const durationValue = (item.estimated_minutes === 15 || item.estimated_minutes === 60 ? item.estimated_minutes : 30) as 15 | 30 | 60;
    const diffValue = (["easy", "medium", "hard"].includes(item.difficulty) ? item.difficulty : "medium") as DifficultyType;
    const archValue = (profile?.explorer_type && ["discovery", "nature", "fitness", "mystery", "social"].includes(profile.explorer_type)
      ? profile.explorer_type
      : "mystery") as ExplorerType;

    const payload: QuestCreateRequest = {
      user_id: userId,
      available_minutes: durationValue,
      explorer_type: archValue,
      difficulty: diffValue,
      latitude: item.latitude,
      longitude: item.longitude,
    };
    await handleGenerateQuest(payload);
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

  // Party handlers
  async function handleCreateParty(payload: PartyCreateRequest) {
    const p = await api.parties.create(payload);
    setParty(p);
    void syncPartyData();
    return p;
  }

  async function handleJoinParty(payload: PartyJoinRequest) {
    const p = await api.parties.join(payload);
    setParty(p);
    void syncPartyData();
    return p;
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
    const updated = await api.parties.getSharedQuest(partyId);
    setCoopQuest(updated);
    void refreshData(userId);
    return res;
  }

  // Filtered Nearby Quests
  const filteredNearbyQuests = useMemo(() => {
    return nearbyQuests.filter((item) => {
      const matchesSearch =
        searchQuery.trim() === "" ||
        item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.description.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesDiff =
        difficultyFilter === "all" ||
        item.difficulty.toLowerCase() === difficultyFilter.toLowerCase();
      return matchesSearch && matchesDiff;
    });
  }, [nearbyQuests, searchQuery, difficultyFilter]);

  const mapCenter = userLocation
    ? { latitude: userLocation.latitude, longitude: userLocation.longitude }
    : { latitude: 37.7749, longitude: -122.4194 };

  const xpProgress = profile ? getXpProgress(profile.xp) : null;
  const isHost = party ? party.host_id === userId : false;

  // Render Left Panel Content
  const renderLeftPanel = () => (
    <div className="h-full flex flex-col space-y-4 pr-1 overflow-y-auto">
      {/* 1. Mode Tabs (Solo Expedition vs Mystery Fellowship) */}
      <div className="flex rounded-xl bg-purple-950/70 p-1 border border-purple-900/60 text-xs shadow-md shrink-0">
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
        /* Active Solo Quest View */
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
        /* Normal Solo Dashboard List */
        <div className="space-y-4">
          {/* 2. Compact Explorer Profile Card */}
          <div className="rounded-2xl border border-purple-800/40 bg-gradient-to-br from-[#15102a] via-[#100d22] to-[#1a1236] p-4 shadow-xl relative overflow-hidden">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="relative flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-tr from-amber-500 via-purple-600 to-indigo-600 shadow-md ring-2 ring-amber-400/30">
                  <span className="font-extrabold text-white text-base">
                    {profile?.level ?? 1}
                  </span>
                  <div className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-[#090812]">
                    <Trophy className="h-2.5 w-2.5" />
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-white text-sm">
                      {profile ? `Explorer Level ${profile.level}` : "Cadet Explorer"}
                    </span>
                    <span className="rounded px-1.5 py-0.2 bg-purple-900/60 text-[10px] text-amber-300 font-bold border border-purple-700/50 uppercase">
                      {profile?.explorer_type || "Mystery"}
                    </span>
                  </div>
                  <p className="text-xs text-purple-300/70 font-medium">
                    {profile ? `${profile.xp} Lifetime XP` : "Sign in to persist your journey"}
                  </p>
                </div>
              </div>

              <button
                onClick={() => setAuthModalOpen(true)}
                className="text-xs px-2.5 py-1 rounded-lg bg-purple-900/40 hover:bg-purple-800/50 text-purple-200 border border-purple-700/40 transition cursor-pointer font-medium"
              >
                {profile ? "Profile" : "Sign In"}
              </button>
            </div>

            {/* XP Progress Bar */}
            <div className="mt-3 space-y-1">
              <div className="flex justify-between text-[11px] font-medium text-purple-300/80">
                <span>Next Tier</span>
                <span className="font-mono text-amber-300">
                  {xpProgress ? `${xpProgress.currentTierXp} / 500 XP (${xpProgress.progressPercent}%)` : "0 / 500 XP"}
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-purple-950/80 overflow-hidden border border-purple-800/40">
                <div
                  className="h-full bg-gradient-to-r from-purple-500 via-amber-400 to-amber-300 rounded-full transition-all duration-500"
                  style={{ width: `${xpProgress?.progressPercent ?? 0}%` }}
                />
              </div>
            </div>
          </div>

          {/* 3. Prominent 'Find Adventure' Golden Button */}
          <button
            onClick={() => setSetupModalOpen(true)}
            className="w-full relative group overflow-hidden rounded-2xl bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 p-[1px] shadow-lg shadow-amber-500/20 hover:shadow-amber-500/40 transition-all cursor-pointer"
          >
            <div className="flex items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-r from-[#20150a] via-[#1a1005] to-[#20150a] px-5 py-3.5 transition group-hover:bg-opacity-90">
              <Sparkles className="h-5 w-5 text-amber-400 animate-pulse" />
              <span className="font-extrabold tracking-wider text-amber-200 group-hover:text-amber-100 text-sm uppercase">
                Find Adventure
              </span>
              <ChevronRight className="h-4 w-4 text-amber-400 transition-transform group-hover:translate-x-1" />
            </div>
          </button>

          {/* 4. Search and Filter Bar */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-purple-400/60" />
                <input
                  type="text"
                  placeholder="Search nearby adventures..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-purple-950/40 border border-purple-800/40 text-xs text-purple-100 placeholder-purple-400/50 focus:outline-none focus:border-purple-600 transition"
                />
              </div>
              <select
                value={difficultyFilter}
                onChange={(e) => setDifficultyFilter(e.target.value)}
                className="px-2.5 py-1.5 rounded-xl bg-purple-950/40 border border-purple-800/40 text-xs text-purple-200 focus:outline-none focus:border-purple-600"
              >
                <option value="all">All Difficulties</option>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </div>
          </div>

          {/* 5. Nearby Adventure Cards */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-bold text-purple-200">
              <span className="flex items-center gap-1.5">
                <Radio className="h-3.5 w-3.5 text-amber-400 animate-pulse" />
                Nearby Adventures ({filteredNearbyQuests.length})
              </span>
              {loadingNearby && <span className="text-[11px] text-amber-400 animate-pulse">Scanning...</span>}
            </div>

            {filteredNearbyQuests.length === 0 ? (
              <div className="rounded-2xl border border-purple-900/40 bg-purple-950/20 p-6 text-center space-y-2">
                <Compass className="h-8 w-8 text-purple-400/40 mx-auto" />
                <p className="text-xs text-purple-300 font-semibold">No Adventures in Current Radius</p>
                <p className="text-[11px] text-purple-400/60">
                  Expand your exploration radius or change your search filter to discover real places.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {filteredNearbyQuests.map((item, idx) => {
                  const isSelected = selectedQuestItem?.title === item.title;
                  const isActive = item.status === "active";
                  const isCompleted = item.status === "completed";
                  const durationWalk = item.is_destination_secret
                    ? "Mystery location"
                    : isSelected && routeInfo && !routeInfo.isMystery
                    ? routeInfo.durationText
                    : item.distance_meters > 0
                    ? `${item.distance_meters > 1000 ? (item.distance_meters / 1000).toFixed(1) + "km" : Math.round(item.distance_meters) + "m"}`
                    : "Nearby";

                  return (
                    <div
                      key={item.id || `${item.title}-${idx}`}
                      onClick={() => setSelectedQuestItem(item)}
                      className={`rounded-2xl p-3.5 border transition cursor-pointer text-left relative overflow-hidden group space-y-2.5 ${
                        isSelected
                          ? "bg-gradient-to-r from-purple-900/70 via-[#1e1544] to-indigo-950/70 border-amber-400/80 shadow-lg shadow-purple-950/50"
                          : "bg-purple-950/30 border-purple-900/40 hover:bg-purple-900/30 hover:border-purple-700/50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <h4 className="font-bold text-xs text-white group-hover:text-amber-200 transition">
                              {item.title}
                            </h4>
                            {item.is_simulated ? (
                              <span className="px-1.5 py-0.2 rounded text-[9px] font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/30">
                                Demo Scenario
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.2 rounded text-[9px] font-semibold bg-purple-500/10 text-purple-300 border border-purple-500/30">
                                {item.status === "completed" ? "Verified" : "Discovered Place"}
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-purple-200/80 line-clamp-2 leading-relaxed">
                            {item.description}
                          </p>
                        </div>

                        {/* Status Badge */}
                        <span
                          className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${
                            isActive
                              ? "bg-amber-500/20 text-amber-300 border-amber-500/40 animate-pulse"
                              : isCompleted
                              ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                              : "bg-purple-900/40 text-purple-300 border-purple-700/40"
                          }`}
                        >
                          {item.status}
                        </span>
                      </div>

                      {/* Adventure Meta Chips */}
                      <div className="flex items-center justify-between text-[11px] text-purple-300/80 border-t border-purple-900/40 pt-2">
                        <div className="flex items-center gap-3">
                          <span className="capitalize text-amber-300 font-semibold">
                            {item.difficulty}
                          </span>
                          <span className="flex items-center gap-1">
                            <Navigation className="h-3 w-3 text-purple-400" />
                            {durationWalk}
                          </span>
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3 text-purple-400" />
                            {item.distance_meters > 1000
                              ? `${(item.distance_meters / 1000).toFixed(1)}km`
                              : `${Math.round(item.distance_meters)}m`}
                          </span>
                        </div>
                        <span className="font-bold text-amber-300">
                          Reward XP: +{item.reward_xp}
                        </span>
                      </div>

                      {/* Primary Action: Start Adventure */}
                      <div className="pt-1 flex items-center justify-end">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleStartAdventure(item);
                          }}
                          className="w-full sm:w-auto px-4 py-2 rounded-xl bg-gradient-to-r from-purple-700 via-amber-600 to-amber-500 hover:from-purple-600 hover:to-amber-400 font-bold text-xs text-white shadow-md transition flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <Play className="h-3.5 w-3.5 fill-current" />
                          <span>{isActive ? "Continue Adventure" : "Start Adventure"}</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 6. Quest Journal / Recent History Section */}
          {quests.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-purple-900/40">
              <h4 className="text-xs font-bold text-purple-300 flex items-center gap-1.5">
                <Trophy className="h-3.5 w-3.5 text-amber-400" />
                Quest Journal ({quests.length})
              </h4>
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {quests.slice(0, 5).map((q) => (
                  <div
                    key={q.id}
                    onClick={() => {
                      setActiveQuest(q);
                      if (q.status === "draft" || q.status === "active") {
                        setSavedActiveQuestId(q.id);
                      }
                    }}
                    className="flex items-center justify-between p-2 rounded-lg bg-purple-950/20 border border-purple-900/30 hover:bg-purple-900/30 transition cursor-pointer text-xs"
                  >
                    <div className="space-y-0.5 truncate pr-2">
                      <p className="font-semibold text-purple-200 truncate">{q.title}</p>
                      <p className="text-[10px] text-purple-400/60">{formatDate(q.created_at)}</p>
                    </div>
                    <span
                      className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        q.status === "completed"
                          ? "text-emerald-400 bg-emerald-950/50"
                          : q.status === "active"
                          ? "text-amber-400 bg-amber-950/50"
                          : "text-purple-400"
                      }`}
                    >
                      {q.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );

  // Render Right Panel (Interactive Map)
  const renderRightPanel = () => (
    <div className="h-full w-full relative rounded-2xl overflow-hidden border border-purple-900/40 shadow-2xl bg-[#090715]">
      {/* 1. Underlying Map Component */}
      {isGoogleMapsReady ? (
        <GoogleMapView
          center={mapCenter}
          userLocation={userLocation}
          radiusMeters={radiusMeters}
          quests={nearbyQuests}
          selectedQuest={selectedQuestItem}
          onSelectQuest={(item) => setSelectedQuestItem(item)}
          activeQuestGeofenceMeters={selectedQuestItem?.verification_radius_meters ?? 100}
          onRouteCalculated={(info) => setRouteInfo(info)}
          activeQuestClues={activeQuest?.current_clues ?? []}
          onRecenterUser={() => void acquireLocation()}
        />
      ) : (
        <RadarMapView
          center={mapCenter}
          userLocation={userLocation}
          radiusMeters={radiusMeters}
          quests={nearbyQuests}
          selectedQuest={selectedQuestItem}
          onSelectQuest={(item) => setSelectedQuestItem(item)}
          activeQuestGeofenceMeters={selectedQuestItem?.verification_radius_meters ?? 100}
        />
      )}

      {/* 2. Floating Top Header Card: Current Location & GPS Accuracy */}
      <div className="absolute top-3 left-3 right-3 sm:right-auto sm:max-w-md z-20">
        <div className="rounded-2xl border border-purple-800/50 bg-[#090814]/90 backdrop-blur-md p-3 shadow-xl space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span
                  className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                    userLocation?.isManual ? "bg-amber-400" : "bg-emerald-400"
                  }`}
                />
                <span
                  className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                    userLocation?.isManual ? "bg-amber-500" : "bg-emerald-500"
                  }`}
                />
              </span>
              <span className="text-[11px] font-bold uppercase tracking-wider text-purple-200">
                {userLocation?.isManual ? "Simulated Coordinates" : "Physical GPS Locked"}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void acquireLocation()}
                disabled={geoLoading}
                className="text-[10px] text-purple-300 hover:text-white flex items-center gap-1 font-semibold disabled:opacity-50"
                title="Retry GPS"
              >
                <RotateCw className={`h-2.5 w-2.5 ${geoLoading ? "animate-spin" : ""}`} />
                <span>Retry GPS</span>
              </button>
              <button
                type="button"
                onClick={() => setSetupModalOpen(true)}
                className="text-[10px] text-amber-300 hover:underline font-semibold"
              >
                Change Location
              </button>
            </div>
          </div>

          <p className="text-xs font-semibold text-white truncate flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5 text-amber-400 shrink-0" />
            <span className="truncate">{addressLabel}</span>
          </p>

          {userLocation && (
            <div className="flex items-center justify-between text-[10px] text-purple-300/70 border-t border-purple-900/40 pt-1">
              <span>
                {userLocation.isManual
                  ? "0 XP Earnable (Manual Selection)"
                  : `GPS Accuracy: ±${Math.round(userLocation.accuracy)}m`}
              </span>
              <span className="font-mono">
                {userLocation.latitude.toFixed(4)}, {userLocation.longitude.toFixed(4)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* 3. Floating Map Controls: Radius selector, Zoom & Recenter */}
      <div className="absolute top-3 right-3 z-20 flex flex-col items-end gap-2">
        {/* Radius Pills */}
        <div className="flex rounded-xl bg-[#090814]/90 backdrop-blur-md p-1 border border-purple-800/50 shadow-xl text-[11px] font-bold">
          {RADIUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setRadiusMeters(opt.value)}
              className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                radiusMeters === opt.value
                  ? "bg-gradient-to-r from-purple-700 to-amber-600 text-white shadow"
                  : "text-purple-300/80 hover:text-white"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Zoom & Recenter Controls */}
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => {
              setRadiusMeters((r) => (r === 5000 ? 2000 : r === 2000 ? 1000 : 500));
            }}
            title="Zoom In"
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#090814]/90 backdrop-blur-md border border-purple-800/50 text-purple-200 hover:text-white hover:border-purple-600 transition shadow-xl cursor-pointer"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              setRadiusMeters((r) => (r === 500 ? 1000 : r === 1000 ? 2000 : 5000));
            }}
            title="Zoom Out"
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#090814]/90 backdrop-blur-md border border-purple-800/50 text-purple-200 hover:text-white hover:border-purple-600 transition shadow-xl cursor-pointer"
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => void acquireLocation()}
            disabled={geoLoading}
            title="Recenter on Explorer Location"
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#090814]/90 backdrop-blur-md border border-purple-800/50 text-amber-400 hover:text-white hover:border-amber-400 transition shadow-xl cursor-pointer"
          >
            <Crosshair className={`h-4 w-4 ${geoLoading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* 4. Floating Bottom Quest Preview Card (When quest is selected) */}
      {selectedQuestItem && (
        <div className="absolute bottom-3 left-3 right-3 sm:left-6 sm:right-6 z-20 animate-in slide-in-from-bottom duration-200">
          <div className="rounded-2xl border border-purple-700/60 bg-[#090814]/95 backdrop-blur-md p-4 shadow-2xl space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-extrabold text-white text-sm">
                    {selectedQuestItem.title}
                  </h3>
                  {selectedQuestItem.is_simulated ? (
                    <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-amber-500/10 text-amber-300 border border-amber-500/30">
                      Demo Scenario (0 XP)
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-purple-500/10 text-purple-300 border border-purple-500/30">
                      {selectedQuestItem.status === "completed" ? "Verified Landmark" : "Discovered Location"}
                    </span>
                  )}
                </div>
                <p className="text-xs text-purple-200/80 leading-relaxed">
                  {selectedQuestItem.description}
                </p>
              </div>

              <button
                onClick={() => setSelectedQuestItem(null)}
                className="text-purple-400 hover:text-white transition p-1"
                aria-label="Close quest preview"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Geofence and Route ETA info */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] border-t border-purple-900/40 pt-2 text-purple-200/80">
              <div className="flex items-center gap-1.5">
                <Shield className="h-3.5 w-3.5 text-amber-400" />
                <span>Geofence: {selectedQuestItem.verification_radius_meters}m</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Navigation className="h-3.5 w-3.5 text-purple-400" />
                <span>
                  {selectedQuestItem.is_destination_secret
                    ? (routeInfo && !routeInfo.isMystery && routeInfo.targetType === "waypoint"
                        ? `Waypoint Walk: ${routeInfo.distanceText} (${routeInfo.durationText})`
                        : "Mystery (follow hints)")
                    : routeInfo && !routeInfo.isMystery
                    ? `Walking route: ${routeInfo.distanceText} (${routeInfo.durationText})`
                    : selectedQuestItem.distance_meters > 0
                    ? `Straight-line: ~${selectedQuestItem.distance_meters > 1000 ? (selectedQuestItem.distance_meters / 1000).toFixed(1) + "km" : Math.round(selectedQuestItem.distance_meters) + "m"}`
                    : "Route available upon arrival"}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-blue-400" />
                <span>{selectedQuestItem.estimated_minutes} min adventure</span>
              </div>
              <div className="flex items-center gap-1.5 font-bold text-amber-400">
                <Trophy className="h-3.5 w-3.5" />
                <span>Reward XP: +{selectedQuestItem.reward_xp}</span>
              </div>
            </div>

            {/* Actions: Start Adventure, Accessible Directions & Google Maps */}
            <div className="flex items-center justify-between gap-3 pt-1 flex-wrap">
              <div className="flex items-center gap-3">
                {!selectedQuestItem.is_destination_secret && (
                  <a
                    href={getGoogleMapsNavigationUrl(
                      selectedQuestItem.latitude,
                      selectedQuestItem.longitude,
                      userLocation?.latitude,
                      userLocation?.longitude
                    )}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-semibold text-purple-300 hover:text-white flex items-center gap-1 transition"
                  >
                    <span>Google Maps Route</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}

                {routeInfo?.steps && routeInfo.steps.length > 0 && !selectedQuestItem.is_destination_secret && (
                  <button
                    type="button"
                    onClick={() => setShowDirectionsModal(true)}
                    className="text-xs font-semibold text-amber-300 hover:text-amber-200 flex items-center gap-1 cursor-pointer"
                  >
                    <ListOrdered className="h-3.5 w-3.5" />
                    <span>Text Directions</span>
                  </button>
                )}

                {selectedQuestItem.is_destination_secret && (
                  <span className="text-xs font-semibold text-amber-300/90 flex items-center gap-1">
                    <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                    <span>Mystery location sealed until clues solved</span>
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={() => void handleStartAdventure(selectedQuestItem)}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-purple-700 via-amber-600 to-amber-500 hover:from-purple-600 hover:to-amber-400 font-bold text-xs text-white shadow-md transition flex items-center gap-1.5 cursor-pointer ml-auto"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                <span>{selectedQuestItem.status === "active" ? "Continue Adventure" : "Start Adventure"}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="h-screen w-screen bg-[#07040d] text-purple-100 flex flex-col font-sans overflow-hidden selection:bg-amber-500/30 selection:text-amber-200">
      {/* 1. Header (Compact Full-Width) */}
      <Header
        profile={profile}
        loading={loading}
        onRefresh={() => void refreshData(userId)}
        onOpenUserModal={() => setAuthModalOpen(true)}
      />

      {/* Backend connection banner if server down */}
      {connectionError && (
        <div className="w-full bg-red-950/80 border-b border-red-800/80 px-4 py-2 text-xs text-red-200 flex items-center justify-between z-50">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
            <span>{connectionError}</span>
          </div>
          <button
            onClick={() => void refreshData(userId)}
            className="text-amber-300 hover:underline font-bold text-[11px]"
          >
            Retry Connection
          </button>
        </div>
      )}

      {/* 2. Main Two-Column Layout (Desktop: 38% Left / 62% Right, Mobile: Map-First or Sheet) */}
      <main className="flex-1 w-full overflow-hidden p-3 sm:p-4">
        {/* Desktop Layout (md+) */}
        <div className="hidden md:flex h-full w-full gap-4">
          {/* Left Panel: 38% Width, Independently Scrollable */}
          <section className="w-[38%] h-full flex flex-col min-w-[320px] max-w-[500px]">
            {renderLeftPanel()}
          </section>

          {/* Right Panel: 62% Width, Large Interactive Google Map */}
          <section className="flex-1 h-full relative">
            {renderRightPanel()}
          </section>
        </div>

        {/* Mobile Layout (< md): Full-Screen Map with Draggable / Expandable Sheet */}
        <div className="flex md:hidden h-full w-full relative">
          {mobileTab === "map" && (
            <div className="h-full w-full relative">
              {renderRightPanel()}

              {/* Mobile Draggable / Expandable Bottom Sheet Trigger */}
              <div
                className={`absolute left-0 right-0 bottom-0 z-30 bg-[#090814]/95 border-t border-purple-800/60 rounded-t-3xl backdrop-blur-md transition-all duration-300 ${
                  mobileSheetOpen ? "h-[80%] p-4 overflow-y-auto" : "h-16 p-3"
                }`}
              >
                <div
                  onClick={() => setMobileSheetOpen(!mobileSheetOpen)}
                  className="w-full flex flex-col items-center justify-center cursor-pointer pb-2"
                >
                  <div className="w-12 h-1.5 bg-purple-700/60 rounded-full mb-1" />
                  <div className="flex items-center justify-between w-full text-xs font-bold text-amber-300 px-2">
                    <span className="flex items-center gap-1.5">
                      <Radio className="h-3 w-3 text-amber-400" />
                      Nearby Quests ({nearbyQuests.length})
                    </span>
                    {mobileSheetOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                  </div>
                </div>

                {mobileSheetOpen && (
                  <div className="mt-2 space-y-4">
                    {renderLeftPanel()}
                  </div>
                )}
              </div>
            </div>
          )}

          {mobileTab === "quests" && (
            <div className="h-full w-full p-2 overflow-y-auto">
              {renderLeftPanel()}
            </div>
          )}

          {mobileTab === "partners" && (
            <div className="h-full w-full p-2 overflow-y-auto">
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
            </div>
          )}

          {mobileTab === "profile" && (
            <div className="h-full w-full p-4 space-y-4 overflow-y-auto">
              <div className="rounded-2xl border border-purple-800/40 bg-purple-950/30 p-5 space-y-4 text-center">
                <div className="flex h-16 w-16 mx-auto items-center justify-center rounded-2xl bg-gradient-to-tr from-amber-500 to-purple-600 text-white font-extrabold text-2xl shadow-xl">
                  {profile?.level ?? 1}
                </div>
                <div>
                  <h3 className="font-extrabold text-lg text-white">
                    {profile ? `Explorer Level ${profile.level}` : "Cadet Explorer"}
                  </h3>
                  <p className="text-xs text-purple-300/70">
                    {currentUserEmail || "Anonymous Scout"}
                  </p>
                </div>
                <button
                  onClick={() => setAuthModalOpen(true)}
                  className="w-full py-2.5 rounded-xl bg-purple-800 hover:bg-purple-700 font-bold text-xs text-white"
                >
                  Manage Account & Auth
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* 3. Mobile Bottom Navigation (< md) */}
      <nav className="flex md:hidden border-t border-purple-900/40 bg-[#090812]/95 backdrop-blur-md px-3 py-2 justify-around items-center z-40">
        <button
          onClick={() => {
            setMobileTab("map");
            setMobileSheetOpen(false);
          }}
          className={`flex flex-col items-center gap-1 text-[10px] font-semibold ${
            mobileTab === "map" ? "text-amber-400" : "text-purple-400/70"
          }`}
        >
          <MapIcon className="h-4 w-4" />
          <span>Map</span>
        </button>
        <button
          onClick={() => setMobileTab("quests")}
          className={`flex flex-col items-center gap-1 text-[10px] font-semibold ${
            mobileTab === "quests" ? "text-amber-400" : "text-purple-400/70"
          }`}
        >
          <Compass className="h-4 w-4" />
          <span>Quests</span>
        </button>
        <button
          onClick={() => setMobileTab("partners")}
          className={`flex flex-col items-center gap-1 text-[10px] font-semibold ${
            mobileTab === "partners" ? "text-amber-400" : "text-purple-400/70"
          }`}
        >
          <Users className="h-4 w-4" />
          <span>Fellowship</span>
        </button>
        <button
          onClick={() => setMobileTab("profile")}
          className={`flex flex-col items-center gap-1 text-[10px] font-semibold ${
            mobileTab === "profile" ? "text-amber-400" : "text-purple-400/70"
          }`}
        >
          <User className="h-4 w-4" />
          <span>Profile</span>
        </button>
      </nav>

      {/* Modals */}
      <QuestSetupModal
        userId={userId}
        isOpen={setupModalOpen}
        onClose={() => setSetupModalOpen(false)}
        onSubmit={handleGenerateQuest}
        initialLocation={userLocation}
        onRequireAuth={(pending) => {
          setPendingQuestPayload(pending);
          setSetupModalOpen(false);
          setAuthModalOpen(true);
        }}
        pendingPayload={pendingQuestPayload}
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

      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        currentEmail={currentUserEmail}
        onAuthenticated={(session) => {
          if (session.user_id) {
            setUserId(session.user_id);
            setActiveUserId(session.user_id);
          }
          setSavedActiveQuestId(null);
          void refreshData(session.user_id);

          if (pendingQuestPayload) {
            const toResume = { ...pendingQuestPayload, user_id: session.user_id || userId };
            setPendingQuestPayload(null);
            void handleGenerateQuest(toResume);
          }
        }}
        onLogout={() => {
          removeAuthToken();
          setProfile(null);
          setQuests([]);
          setActiveQuest(null);
          setCurrentUserEmail(null);
          setSavedActiveQuestId(null);
          setPendingQuestPayload(null);
        }}
      />

      {/* Accessible Turn-by-Turn Text Directions Modal */}
      {showDirectionsModal && routeInfo?.steps && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200"
          role="dialog"
          aria-modal="true"
          aria-labelledby="text-directions-title"
        >
          <div className="card-runic w-full max-w-lg rounded-2xl border border-purple-600/50 p-5 space-y-4 max-h-[80vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between border-b border-purple-900/40 pb-3">
              <div className="flex items-center gap-2">
                <ListOrdered className="h-4 w-4 text-amber-400" />
                <h3 id="text-directions-title" className="font-bold text-white text-sm">
                  Walking Directions (Accessible Text)
                </h3>
              </div>
              <button
                onClick={() => setShowDirectionsModal(false)}
                className="text-purple-400 hover:text-white p-1 rounded-lg transition"
                aria-label="Close directions"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="text-xs text-purple-200/90 space-y-1">
              <p className="font-semibold text-amber-300">
                Walking Route: {routeInfo.durationText} ({routeInfo.distanceText})
              </p>
              <p className="text-[11px] text-purple-300/70">
                Turn-by-turn pedestrian path instructions from your current GPS position.
              </p>
            </div>
            <ol className="space-y-2.5 text-xs text-slate-100 list-decimal pl-5">
              {routeInfo.steps.map((st, i) => (
                <li key={i} className="leading-relaxed">
                  <span>{st.instructions}</span>
                  {st.distanceText && (
                    <span className="ml-1 text-[11px] text-amber-400/80 font-mono">
                      ({st.distanceText})
                    </span>
                  )}
                </li>
              ))}
            </ol>
            <button
              onClick={() => setShowDirectionsModal(false)}
              className="btn-primary-rpg w-full py-2.5 rounded-xl text-xs font-bold text-white cursor-pointer"
            >
              Close Text Directions
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
