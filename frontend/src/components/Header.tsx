"use client";

import React from "react";
import { Compass, Sparkles, User, RefreshCw } from "lucide-react";
import type { ProfileResponse } from "@/types/api";

interface HeaderProps {
  profile: ProfileResponse | null;
  loading: boolean;
  onRefresh: () => void;
  onOpenUserModal: () => void;
}

export function Header({ profile, loading, onRefresh, onOpenUserModal }: HeaderProps) {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-purple-900/30 bg-[#090812]/80 backdrop-blur-md px-4 py-3">
      <div className="mx-auto flex max-w-md md:max-w-4xl items-center justify-between">
        {/* Brand */}
        <div className="flex items-center gap-2.5">
          <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-purple-600 via-indigo-600 to-amber-500 shadow-md shadow-purple-950/50">
            <Compass className="h-5 w-5 text-white animate-[spin_20s_linear_infinite]" />
            <div className="absolute inset-0 rounded-xl border border-white/20" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-extrabold tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-purple-200 via-amber-200 to-amber-400 text-lg leading-none">
                WAYBOUND
              </span>
              <span className="rounded bg-amber-500/10 border border-amber-500/30 px-1 py-0.2 text-[9px] font-bold text-amber-300">
                MVP
              </span>
            </div>
            <p className="text-[10px] text-purple-300/60 font-medium tracking-wide">
              AI Real-World Mystery Quests
            </p>
          </div>
        </div>

        {/* Right Action / Explorer Status */}
        <div className="flex items-center gap-2">
          <button
            onClick={onRefresh}
            disabled={loading}
            title="Refresh status"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-purple-800/40 bg-purple-950/40 text-purple-300 hover:bg-purple-900/40 transition disabled:opacity-50"
            aria-label="Refresh status"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>

          <button
            onClick={onOpenUserModal}
            className="flex items-center gap-1.5 rounded-lg border border-purple-800/50 bg-gradient-to-r from-purple-950/60 to-indigo-950/60 px-2.5 py-1.5 text-xs text-purple-200 hover:border-purple-600/70 transition shadow-sm"
          >
            <User className="h-3.5 w-3.5 text-amber-400" />
            <span className="font-medium hidden sm:inline">Explorer:</span>
            <span className="font-semibold text-amber-300">
              {profile ? `Lv. ${profile.level}` : "Setup"}
            </span>
            <Sparkles className="h-3 w-3 text-purple-400" />
          </button>
        </div>
      </div>
    </header>
  );
}
