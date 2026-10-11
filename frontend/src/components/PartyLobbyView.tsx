"use client";

import React, { useState } from "react";
import {
  Users,
  UserPlus,
  Shield,
  ShieldCheck,
  Copy,
  Check,
  Sparkles,
  Play,
  LogOut,
  Trash2,
  Loader2,
  Clock,
  Compass,
  KeyRound,
  RefreshCw,
} from "lucide-react";
import type { PartyResponse, PartyCreateRequest, PartyJoinRequest, PartyStartQuestRequest } from "@/types/party";
import type { AvailableMinutesType, DifficultyType, ExplorerType } from "@/types/api";

interface PartyLobbyViewProps {
  currentUserId: string;
  party: PartyResponse | null;
  onRefreshParty: () => Promise<void>;
  onCreateParty: (payload: PartyCreateRequest) => Promise<PartyResponse>;
  onJoinParty: (payload: PartyJoinRequest) => Promise<PartyResponse>;
  onLeaveParty: (partyId: string) => Promise<void>;
  onDisbandParty: (partyId: string) => Promise<void>;
  onSetConsent: (partyId: string, consent: boolean) => Promise<void>;
  onStartQuest: (partyId: string, payload: PartyStartQuestRequest) => Promise<void>;
  onOpenQuest: () => void;
  myParties: PartyResponse[];
  onSelectParty: (partyId: string) => void;
}

export function PartyLobbyView({
  currentUserId,
  party,
  onRefreshParty,
  onCreateParty,
  onJoinParty,
  onLeaveParty,
  onDisbandParty,
  onSetConsent,
  onStartQuest,
  onOpenQuest,
  myParties,
  onSelectParty,
}: PartyLobbyViewProps) {
  // Creation state
  const [createName, setCreateName] = useState("Mystery Fellowship");
  const [createNickname, setCreateNickname] = useState("Pathfinder");
  const [creating, setCreating] = useState(false);

  // Joining state
  const [joinToken, setJoinToken] = useState("");
  const [joinNickname, setJoinNickname] = useState("Wayfarer");
  const [joining, setJoining] = useState(false);

  // Quest Start Config (for Host)
  const [minutes, setMinutes] = useState<AvailableMinutesType>(30);
  const [difficulty, setDifficulty] = useState<DifficultyType>("medium");
  const [explorerType, setExplorerType] = useState<ExplorerType>("mystery");
  const [startingQuest, setStartingQuest] = useState(false);

  // UI state
  const [copiedToken, setCopiedToken] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const isHost = party ? party.host_id === currentUserId : false;
  const myMembership = party?.members.find((m) => m.user_id === currentUserId);
  const isBothConsented = party ? party.members.length === 2 && party.members.every((m) => m.is_real_name_revealed) : false;

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setActionError(null);
    setCreating(true);
    try {
      await onCreateParty({
        name: createName.trim() || "Mystery Fellowship",
        nickname: createNickname.trim() || "Pathfinder",
      });
    } catch (err: unknown) {
      setActionError((err as Error)?.message || "Failed to create party.");
    } finally {
      setCreating(false);
    }
  }

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!joinToken.trim()) {
      setActionError("Please paste an opaque invitation token.");
      return;
    }
    setActionError(null);
    setJoining(true);
    try {
      await onJoinParty({
        invite_token: joinToken.trim(),
        nickname: joinNickname.trim() || "Wayfarer",
      });
      setJoinToken("");
    } catch (err: unknown) {
      setActionError((err as Error)?.message || "Failed to join party. The token may be expired or full.");
    } finally {
      setJoining(false);
    }
  }

  async function handleCopyToken(token: string) {
    try {
      await navigator.clipboard.writeText(token);
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 2500);
    } catch {
      // fallback
    }
  }

  async function handleToggleConsent() {
    if (!party || !myMembership) return;
    setActionError(null);
    setBusyAction("consent");
    try {
      const nextConsent = !myMembership.is_real_name_revealed;
      await onSetConsent(party.id, nextConsent);
    } catch (err: unknown) {
      setActionError((err as Error)?.message || "Failed to update identity reveal consent.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleStartCoopQuest() {
    if (!party) return;
    setActionError(null);
    setStartingQuest(true);
    try {
      await onStartQuest(party.id, {
        available_minutes: minutes,
        difficulty,
        explorer_type: explorerType,
      });
    } catch (err: unknown) {
      setActionError((err as Error)?.message || "Failed to start cooperative quest.");
    } finally {
      setStartingQuest(false);
    }
  }

  async function handleLeave() {
    if (!party) return;
    if (!confirm("Are you sure you want to leave this fellowship?")) return;
    setBusyAction("leave");
    try {
      await onLeaveParty(party.id);
    } catch (err: unknown) {
      setActionError((err as Error)?.message || "Failed to leave party.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDisband() {
    if (!party) return;
    if (!confirm("Are you sure you want to disband this fellowship for both explorers?")) return;
    setBusyAction("disband");
    try {
      await onDisbandParty(party.id);
    } catch (err: unknown) {
      setActionError((err as Error)?.message || "Failed to disband party.");
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      {/* Action Error Banner */}
      {actionError && (
        <div className="rounded-xl bg-red-950/40 border border-red-800/60 p-3 text-xs text-red-200">
          {actionError}
        </div>
      )}

      {/* If No Active Party Selected */}
      {!party ? (
        <div className="space-y-5">
          {/* Hero Explainer */}
          <div className="rounded-2xl border border-purple-800/60 bg-gradient-to-b from-[#1b1130] to-[#0e081c] p-5 shadow-xl space-y-2 text-center">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/20 text-amber-300">
              <Users className="h-5 w-5" />
            </div>
            <h2 className="text-base font-bold text-purple-100">Social Mystery Fellowship</h2>
            <p className="text-xs text-purple-300/80 max-w-sm mx-auto leading-relaxed">
              Pair up with a partner for complementary mystery quests. Each explorer receives unique clues, while live coordinates and identities stay strictly private by default.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Create Party Card */}
            <form
              onSubmit={handleCreate}
              className="rounded-2xl border border-purple-900/60 bg-gradient-to-b from-[#160c29] to-[#0d071a] p-4 shadow-lg space-y-3"
            >
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/20 text-amber-300">
                  <UserPlus className="h-3.5 w-3.5" />
                </div>
                <h3 className="text-xs font-bold text-purple-100 uppercase tracking-wider">Form Fellowship</h3>
              </div>

              <div className="space-y-2">
                <div>
                  <label className="text-[11px] font-semibold text-purple-300">Fellowship Name</label>
                  <input
                    type="text"
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                    placeholder="Mystery Fellowship"
                    disabled={creating}
                    className="w-full rounded-xl border border-purple-800/70 bg-purple-950/40 px-3 py-2 text-xs text-purple-100 placeholder-purple-500/60 focus:border-amber-500/70 focus:outline-none transition"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-purple-300">Your Explorer Nickname</label>
                  <input
                    type="text"
                    value={createNickname}
                    onChange={(e) => setCreateNickname(e.target.value)}
                    placeholder="Pathfinder"
                    disabled={creating}
                    className="w-full rounded-xl border border-purple-800/70 bg-purple-950/40 px-3 py-2 text-xs text-purple-100 placeholder-purple-500/60 focus:border-amber-500/70 focus:outline-none transition"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={creating}
                className="w-full flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 py-2.5 text-xs font-bold text-white shadow-lg shadow-amber-950/50 disabled:opacity-50 transition cursor-pointer"
              >
                {creating ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Creating Fellowship...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>Create & Get Invitation Token</span>
                  </>
                )}
              </button>
            </form>

            {/* Join Party Card */}
            <form
              onSubmit={handleJoin}
              className="rounded-2xl border border-purple-900/60 bg-gradient-to-b from-[#160c29] to-[#0d071a] p-4 shadow-lg space-y-3"
            >
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-purple-800/40 text-purple-200">
                  <KeyRound className="h-3.5 w-3.5" />
                </div>
                <h3 className="text-xs font-bold text-purple-100 uppercase tracking-wider">Join with Invite Token</h3>
              </div>

              <div className="space-y-2">
                <div>
                  <label className="text-[11px] font-semibold text-purple-300">Invitation Token</label>
                  <input
                    type="text"
                    value={joinToken}
                    onChange={(e) => setJoinToken(e.target.value)}
                    placeholder="Paste private opaque token..."
                    disabled={joining}
                    className="w-full rounded-xl border border-purple-800/70 bg-purple-950/40 px-3 py-2 text-xs text-purple-100 placeholder-purple-500/60 focus:border-amber-500/70 focus:outline-none transition font-mono"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-purple-300">Your Explorer Nickname</label>
                  <input
                    type="text"
                    value={joinNickname}
                    onChange={(e) => setJoinNickname(e.target.value)}
                    placeholder="Wayfarer"
                    disabled={joining}
                    className="w-full rounded-xl border border-purple-800/70 bg-purple-950/40 px-3 py-2 text-xs text-purple-100 placeholder-purple-500/60 focus:border-amber-500/70 focus:outline-none transition"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={joining || !joinToken.trim()}
                className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-purple-700/60 bg-purple-800/40 hover:bg-purple-700/40 py-2.5 text-xs font-bold text-purple-100 shadow-lg disabled:opacity-50 transition cursor-pointer"
              >
                {joining ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Verifying Invitation...</span>
                  </>
                ) : (
                  <>
                    <Users className="h-3.5 w-3.5" />
                    <span>Join Fellowship</span>
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Existing Fellowships List if any */}
          {myParties.length > 0 && (
            <div className="space-y-2.5 pt-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-purple-300">
                Your Ongoing Fellowships
              </h3>
              <div className="grid grid-cols-1 gap-2">
                {myParties.map((p) => (
                  <div
                    key={p.id}
                    onClick={() => onSelectParty(p.id)}
                    className="flex items-center justify-between p-3 rounded-xl border border-purple-900/60 bg-purple-950/30 hover:bg-purple-900/30 hover:border-purple-700/60 transition cursor-pointer"
                  >
                    <div>
                      <p className="text-xs font-bold text-purple-100">{p.name}</p>
                      <p className="text-[10px] text-purple-400/80">
                        Status: <span className="uppercase font-semibold text-amber-300">{p.status}</span> • {p.members.length}/2 Explorers
                      </p>
                    </div>
                    <span className="text-[11px] font-medium text-amber-300 hover:underline">
                      Enter Lobby →
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* In-Party Lobby View */
        <div className="space-y-4">
          {/* Header Card */}
          <div className="rounded-2xl border border-purple-800/60 bg-gradient-to-b from-[#1b1130] to-[#0f091d] p-5 shadow-xl space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="inline-flex items-center gap-1.5 rounded-full border border-purple-700/60 bg-purple-900/40 px-2.5 py-0.5 text-[10px] font-semibold text-purple-300">
                  <Users className="h-3 w-3 text-amber-400" />
                  <span>{isHost ? "You are Fellowship Host" : "Fellowship Member"}</span>
                </div>
                <h2 className="text-base font-bold text-purple-100 mt-1">{party.name}</h2>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => void onRefreshParty()}
                  className="p-1.5 rounded-lg border border-purple-800/50 bg-purple-950/40 text-purple-300 hover:text-purple-100 transition"
                  title="Refresh party"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                    party.status === "active"
                      ? "bg-emerald-950/80 text-emerald-300 border border-emerald-700/60"
                      : "bg-amber-950/80 text-amber-300 border border-amber-700/60"
                  }`}
                >
                  {party.status === "open" ? "Waiting for Partner" : party.status}
                </span>
              </div>
            </div>

            {/* Waiting for Partner / Private Invite Token Box */}
            {party.status === "open" && party.invite_token && (
              <div className="rounded-xl border border-amber-600/50 bg-amber-950/20 p-4 space-y-2.5">
                <div className="flex items-center gap-2 text-xs font-bold text-amber-200">
                  <span className="h-2 w-2 rounded-full bg-amber-400 animate-ping" />
                  <span>Lobby Open: Waiting for Mystery Partner</span>
                </div>
                <p className="text-[11px] text-purple-300/80 leading-relaxed">
                  Share this private invitation token with your partner. When they enter the token, you will both join the cooperative fellowship.
                </p>

                <div className="flex items-center gap-2">
                  <div className="flex-1 rounded-xl border border-purple-800/80 bg-purple-950/70 px-3 py-2 text-xs font-mono text-purple-100 overflow-x-auto truncate select-all">
                    {party.invite_token}
                  </div>
                  <button
                    onClick={() => handleCopyToken(party.invite_token || "")}
                    className="flex items-center gap-1.5 rounded-xl border border-amber-500/60 bg-amber-500/20 px-3 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-500/30 transition shrink-0 cursor-pointer"
                  >
                    {copiedToken ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                        <span className="text-emerald-300">Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        <span>Copy Token</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="flex items-center gap-1.5 text-[10px] text-purple-400/70">
                  <Clock className="h-3 w-3" />
                  <span>Token expires in 48 hours. Max 2 explorers per party.</span>
                </div>
              </div>
            )}
          </div>

          {/* Members Roster Card */}
          <div className="rounded-2xl border border-purple-900/60 bg-gradient-to-b from-[#160c29] to-[#0d071a] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-purple-300">
                Fellowship Explorers ({party.members.length}/2)
              </h3>
              {isBothConsented && (
                <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-300 bg-emerald-950/60 border border-emerald-700/60 px-2 py-0.5 rounded-full">
                  <ShieldCheck className="h-3 w-3" />
                  <span>Mutual Consent Active</span>
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {party.members.map((member) => {
                const isMe = member.user_id === currentUserId;
                return (
                  <div
                    key={member.user_id}
                    className={`rounded-xl border p-3 flex items-center justify-between ${
                      isMe
                        ? "border-amber-600/50 bg-amber-950/20"
                        : "border-purple-850/60 bg-purple-950/30"
                    }`}
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-purple-100">
                          {member.display_name}
                        </span>
                        {isMe && (
                          <span className="rounded bg-amber-500/20 px-1.5 py-0.2 text-[9px] font-semibold text-amber-300">
                            You
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-purple-400/80">
                        Slot {member.slot_number} • {member.role === "host" ? "Host" : "Member"}
                      </p>
                    </div>

                    <span className="text-[10px] font-medium text-emerald-300 bg-emerald-950/40 border border-emerald-800/40 px-2 py-0.5 rounded-full">
                      Ready
                    </span>
                  </div>
                );
              })}

              {/* Waiting placeholder slot if only 1 member */}
              {party.members.length < 2 && (
                <div className="rounded-xl border border-dashed border-purple-900/60 bg-purple-950/10 p-3 flex items-center justify-center text-purple-400/60 text-xs gap-1.5">
                  <Users className="h-4 w-4 animate-pulse" />
                  <span>Awaiting Partner Explorer...</span>
                </div>
              )}
            </div>

            {/* Mutual Identity Reveal Consent Toggle */}
            {party.members.length === 2 && (
              <div className="rounded-xl border border-purple-800/50 bg-purple-950/30 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Shield className="h-3.5 w-3.5 text-amber-400" />
                    <span className="text-xs font-bold text-purple-200">
                      Identity Privacy Protection
                    </span>
                  </div>
                  <button
                    onClick={handleToggleConsent}
                    disabled={busyAction === "consent"}
                    className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg border transition cursor-pointer ${
                      myMembership?.is_real_name_revealed
                        ? "border-red-700/60 bg-red-950/40 text-red-200 hover:bg-red-900/40"
                        : "border-purple-600/60 bg-purple-800/30 text-purple-200 hover:bg-purple-700/40"
                    }`}
                  >
                    {myMembership?.is_real_name_revealed
                      ? "Revoke Identity Consent"
                      : "Consent to Reveal Real Name"}
                  </button>
                </div>
                <p className="text-[10px] text-purple-300/70 leading-relaxed">
                  {isBothConsented
                    ? "Both explorers have granted consent. Real names are revealed to each other."
                    : myMembership?.is_real_name_revealed
                    ? "You have granted consent. Real names will be shown once your partner also consents."
                    : "Explorer identities are shielded by nicknames. You can optionally share real names with mutual consent."}
                </p>
              </div>
            )}
          </div>

          {/* Active Quest Action OR Quest Launcher */}
          {party.has_active_quest ? (
            <div className="rounded-2xl border border-amber-600/60 bg-gradient-to-r from-amber-950/40 to-purple-950/40 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold text-amber-200">Cooperative Quest in Progress</h3>
                  <p className="text-[11px] text-purple-300/80">Complementary clues are active for both explorers.</p>
                </div>
                <button
                  onClick={onOpenQuest}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-xs font-bold text-white shadow-lg shadow-amber-950/50 transition cursor-pointer"
                >
                  <Play className="h-3.5 w-3.5" />
                  <span>Resume Quest</span>
                </button>
              </div>
            </div>
          ) : party.members.length === 2 && isHost ? (
            /* Host Quest Generator Controls */
            <div className="rounded-2xl border border-purple-800/60 bg-gradient-to-b from-[#180e2c] to-[#0e071a] p-4 space-y-3">
              <div className="flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-amber-400" />
                <h3 className="text-xs font-bold text-purple-100 uppercase tracking-wider">
                  Embark on Cooperative Quest
                </h3>
              </div>

              {/* Explorer Archetype */}
              <div>
                <label className="text-[11px] font-semibold text-purple-300 block mb-1">Explorer Archetype</label>
                <div className="grid grid-cols-4 gap-1.5">
                  {(["mystery", "history", "nature", "urban"] as ExplorerType[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setExplorerType(t)}
                      className={`py-1.5 rounded-xl text-[11px] font-semibold capitalize border transition cursor-pointer ${
                        explorerType === t
                          ? "border-amber-500 bg-amber-500/20 text-amber-200"
                          : "border-purple-800/60 bg-purple-950/30 text-purple-300 hover:bg-purple-900/30"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              {/* Time selection */}
              <div>
                <label className="text-[11px] font-semibold text-purple-300 block mb-1">Duration</label>
                <div className="grid grid-cols-3 gap-2">
                  {([15, 30, 60] as AvailableMinutesType[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMinutes(m)}
                      className={`py-1.5 rounded-xl text-xs font-semibold border transition cursor-pointer ${
                        minutes === m
                          ? "border-amber-500 bg-amber-500/20 text-amber-200"
                          : "border-purple-800/60 bg-purple-950/30 text-purple-300 hover:bg-purple-900/30"
                      }`}
                    >
                      {m} min
                    </button>
                  ))}
                </div>
              </div>

              {/* Difficulty */}
              <div>
                <label className="text-[11px] font-semibold text-purple-300 block mb-1">Difficulty</label>
                <div className="grid grid-cols-3 gap-2">
                  {(["easy", "medium", "hard"] as DifficultyType[]).map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDifficulty(d)}
                      className={`py-1.5 rounded-xl text-xs font-semibold capitalize border transition cursor-pointer ${
                        difficulty === d
                          ? "border-amber-500 bg-amber-500/20 text-amber-200"
                          : "border-purple-800/60 bg-purple-950/30 text-purple-300 hover:bg-purple-900/30"
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={handleStartCoopQuest}
                disabled={startingQuest}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 py-3 text-xs font-bold text-white shadow-lg shadow-amber-950/60 transition cursor-pointer"
              >
                {startingQuest ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Generating Complementary Quest Narrative...</span>
                  </>
                ) : (
                  <>
                    <Compass className="h-4 w-4" />
                    <span>Start Two-Player Cooperative Quest</span>
                  </>
                )}
              </button>
            </div>
          ) : party.members.length === 2 ? (
            /* Member waiting for host */
            <div className="rounded-2xl border border-purple-900/60 bg-purple-950/30 p-4 text-center space-y-1.5">
              <Compass className="h-5 w-5 text-amber-400 mx-auto animate-spin" style={{ animationDuration: "12s" }} />
              <p className="text-xs font-semibold text-purple-200">Both Explorers Assembled!</p>
              <p className="text-[11px] text-purple-400/80">Waiting for fellowship host to begin the expedition...</p>
            </div>
          ) : null}

          {/* Leave / Disband Actions */}
          <div className="pt-2 flex items-center justify-end gap-2 border-t border-purple-900/50">
            {isHost ? (
              <button
                onClick={handleDisband}
                disabled={busyAction === "disband"}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-red-900/50 bg-red-950/30 hover:bg-red-900/40 text-xs font-semibold text-red-300 transition cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Disband Fellowship</span>
              </button>
            ) : (
              <button
                onClick={handleLeave}
                disabled={busyAction === "leave"}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-purple-800/60 bg-purple-950/40 hover:bg-purple-900/40 text-xs font-semibold text-purple-300 transition cursor-pointer"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>Leave Fellowship</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
