"use client";

import React from "react";
import { Shield, Sparkles, Award, Play, Flame } from "lucide-react";
import type { ProfileResponse } from "@/types/api";
import { getXpProgress } from "@/lib/utils";

interface ProfileCardProps {
  profile: ProfileResponse | null;
  loading: boolean;
  onBeginAdventure: () => void;
  onSelectUser: () => void;
}

const ARCHETYPE_ICONS: Record<string, string> = {
  mystery: "🔮",
  discovery: "🧭",
  nature: "🌿",
  fitness: "⚡",
  social: "🤝",
};

export function ProfileCard({
  profile,
  loading,
  onBeginAdventure,
  onSelectUser,
}: ProfileCardProps) {
  if (loading) {
    return (
      <div className="card-runic rounded-2xl p-5 animate-pulse space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-14 w-14 rounded-xl bg-purple-900/40" />
          <div className="space-y-2 flex-1">
            <div className="h-4 w-32 rounded bg-purple-900/40" />
            <div className="h-3 w-20 rounded bg-purple-900/20" />
          </div>
        </div>
        <div className="h-3 w-full rounded bg-purple-900/30" />
        <div className="h-12 w-full rounded-xl bg-purple-900/50" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="card-runic-gold rounded-2xl p-5 text-center space-y-4">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400">
          <Shield className="h-7 w-7" />
        </div>
        <div>
          <h3 className="text-base font-bold text-amber-200">
            Explorer Profile Not Found
          </h3>
          <p className="mt-1 text-xs text-purple-200/70 max-w-xs mx-auto">
            Connect using your Explorer ID or initialize the demo explorer to start generating real-world quests.
          </p>
        </div>
        <button
          onClick={onSelectUser}
          className="w-full rounded-xl border border-amber-500/50 bg-amber-500/15 py-2.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/25 transition"
        >
          Select or Initialize Explorer
        </button>
      </div>
    );
  }

  const { currentTierXp, tierTargetXp, progressPercent, xpUntilNext } =
    getXpProgress(profile.xp);

  const archetypeSymbol = ARCHETYPE_ICONS[profile.explorer_type] || "✨";

  return (
    <div className="card-runic rounded-2xl p-5 relative overflow-hidden">
      {/* Background ambient glow */}
      <div className="absolute -top-12 -right-12 h-36 w-36 rounded-full bg-purple-600/15 blur-2xl pointer-events-none" />

      {/* Profile Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3.5">
          <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-800 to-indigo-950 border border-purple-500/40 shadow-inner">
            <span className="text-2xl" role="img" aria-label="archetype">
              {archetypeSymbol}
            </span>
            <div className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-[10px] font-black text-amber-950 shadow">
              {profile.level}
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-white tracking-wide">
                Pathseeker
              </h2>
              <span className="capitalize rounded-full bg-purple-500/20 border border-purple-500/30 px-2 py-0.5 text-[10px] font-medium text-purple-300">
                {profile.explorer_type}
              </span>
            </div>
            <p className="text-xs text-purple-300/70 mt-0.5 flex items-center gap-1">
              <Award className="h-3 w-3 text-amber-400" />
              <span>Level {profile.level} Explorer</span>
              <span className="text-purple-400/40">•</span>
              <span className="text-amber-300 font-semibold">{profile.xp} XP Total</span>
            </p>
          </div>
        </div>

        <button
          onClick={onSelectUser}
          className="text-[11px] text-purple-400 hover:text-purple-200 transition underline underline-offset-4"
        >
          Change
        </button>
      </div>

      {/* XP Progress Bar */}
      <div className="mt-4 space-y-1.5">
        <div className="flex justify-between text-[11px]">
          <span className="text-purple-300/80 font-medium flex items-center gap-1">
            <Flame className="h-3 w-3 text-amber-400" />
            Progression Tier
          </span>
          <span className="text-purple-200 font-semibold">
            {currentTierXp} / {tierTargetXp} XP ({xpUntilNext} XP to Level {profile.level + 1})
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-purple-950/80 border border-purple-800/40 p-[1px]">
          <div
            className="h-full rounded-full bg-gradient-to-r from-purple-500 via-indigo-400 to-amber-400 transition-all duration-500"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Primary Action: Begin Adventure */}
      <div className="mt-5">
        <button
          onClick={onBeginAdventure}
          id="begin-adventure-btn"
          className="btn-primary-rpg w-full flex items-center justify-center gap-2.5 rounded-xl py-3.5 px-4 text-sm font-bold text-white tracking-wider cursor-pointer shadow-lg"
        >
          <Play className="h-4 w-4 fill-white" />
          <span>BEGIN ADVENTURE</span>
          <Sparkles className="h-4 w-4 text-amber-300 animate-pulse" />
        </button>
      </div>
    </div>
  );
}
