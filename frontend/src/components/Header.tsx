"use client";

import React from "react";
import { Compass, Sparkles, User, RefreshCw, Trophy, Shield } from "lucide-react";
import type { ProfileResponse } from "@/types/api";

interface HeaderProps {
  profile: ProfileResponse | null;
  loading: boolean;
  onRefresh: () => void;
  onOpenUserModal: () => void;
  onOpenMap?: () => void;
}

export function Header({ profile, loading, onRefresh, onOpenUserModal }: HeaderProps) {
  const currentXp = profile?.xp ?? 0;
  const currentLevel = profile?.level ?? 1;
  const xpNeeded = currentLevel * 500;
  const progressPercent = Math.min(100, Math.max(0, Math.round(((currentXp % 500) / 500) * 100)));

  return (
    <header className="sticky top-0 z-40 w-full border-b border-purple-900/40 bg-[#090812]/90 backdrop-blur-md px-4 sm:px-6 py-2.5">
      <div className="flex w-full items-center justify-between gap-4">
        {/* Brand / Logo */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-purple-600 via-indigo-600 to-amber-500 shadow-md shadow-purple-950/60 ring-1 ring-white/20">
            <Compass className="h-5 w-5 text-white animate-[spin_30s_linear_infinite]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-purple-200 via-amber-200 to-amber-400 text-lg leading-tight">
                WAYBOUND
              </span>
              <span className="hidden md:inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-300 border border-amber-500/30">
                ADVENTURE OS
              </span>
            </div>
            <p className="text-[10px] text-purple-300/60 font-medium tracking-wide">
              Real-World Mystery Exploration Engine
            </p>
          </div>
        </div>

        {/* Center: Compact Level & XP Bar (Visible on md+) */}
        {profile && (
          <div className="hidden lg:flex items-center gap-3 bg-purple-950/40 border border-purple-800/40 rounded-full px-4 py-1.5 shadow-inner">
            <div className="flex items-center gap-1.5 text-xs">
              <Trophy className="h-3.5 w-3.5 text-amber-400" />
              <span className="text-purple-300 font-medium">Rank:</span>
              <span className="font-bold text-amber-300 capitalize">{profile.explorer_type || "Explorer"}</span>
            </div>
            <div className="h-3 w-px bg-purple-800/60" />
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-purple-200">Lv. {currentLevel}</span>
              <div className="w-24 h-2 bg-purple-950 rounded-full overflow-hidden border border-purple-800/50">
                <div
                  className="h-full bg-gradient-to-r from-amber-500 to-amber-300 rounded-full transition-all duration-500"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <span className="text-[10px] font-mono text-purple-300/70">
                {currentXp} / {xpNeeded} XP
              </span>
            </div>
          </div>
        )}

        {/* Right Actions: Refresh & Explorer Profile Trigger */}
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            onClick={onRefresh}
            disabled={loading}
            title="Refresh game data"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-purple-800/40 bg-purple-950/40 text-purple-300 hover:bg-purple-900/40 transition cursor-pointer disabled:opacity-50"
            aria-label="Refresh status"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin text-amber-400" : ""}`} />
          </button>

          <button
            onClick={onOpenUserModal}
            className="flex items-center gap-2 rounded-xl border border-purple-800/50 bg-gradient-to-r from-purple-950/80 via-indigo-950/70 to-purple-950/80 px-3 py-1.5 text-xs text-purple-200 hover:border-amber-500/50 hover:shadow-[0_0_15px_rgba(245,158,11,0.15)] transition cursor-pointer shadow-sm group"
          >
            <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-purple-900/80 border border-purple-700/60 text-amber-300 group-hover:scale-105 transition-transform">
              {profile ? <Shield className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}
            </div>
            <div className="text-left hidden sm:block">
              <div className="text-[10px] text-purple-400/80 font-medium leading-none">
                {profile ? "Explorer Active" : "Guest Mode"}
              </div>
              <div className="font-bold text-amber-300 text-xs leading-tight">
                {profile ? `Lv. ${profile.level}` : "Sign In / Setup"}
              </div>
            </div>
            <Sparkles className="h-3.5 w-3.5 text-amber-400/80 ml-0.5" />
          </button>
        </div>
      </div>
    </header>
  );
}

