"use client";

import React from "react";
import { Scroll, Clock, CheckCircle2, AlertCircle, Compass, ChevronRight, Lock } from "lucide-react";
import type { QuestResponse } from "@/types/api";
import { formatDate, isSimulatedQuest } from "@/lib/utils";

interface QuestHistoryCardProps {
  quests: QuestResponse[];
  loading: boolean;
  onSelectQuest: (quest: QuestResponse) => void;
}

const STATUS_CONFIG: Record<
  string,
  { label: string; badgeClass: string; icon: React.ReactNode }
> = {
  active: {
    label: "Active",
    badgeClass: "bg-purple-500/20 text-purple-300 border-purple-500/40",
    icon: <Compass className="h-3 w-3 animate-spin text-purple-300" />,
  },
  draft: {
    label: "Draft",
    badgeClass: "bg-blue-500/20 text-blue-300 border-blue-500/40",
    icon: <Clock className="h-3 w-3 text-blue-300" />,
  },
  completed: {
    label: "Completed",
    badgeClass: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
    icon: <CheckCircle2 className="h-3 w-3 text-emerald-400" />,
  },
  abandoned: {
    label: "Abandoned",
    badgeClass: "bg-slate-700/40 text-slate-400 border-slate-600/40",
    icon: <AlertCircle className="h-3 w-3 text-slate-400" />,
  },
};

export function QuestHistoryCard({
  quests,
  loading,
  onSelectQuest,
}: QuestHistoryCardProps) {
  if (loading) {
    return (
      <div className="card-runic rounded-2xl p-5 space-y-3">
        <div className="h-4 w-28 rounded bg-purple-900/40 animate-pulse" />
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-xl bg-purple-900/20 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="card-runic rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <Scroll className="h-4 w-4 text-amber-400" />
          Quest Journal
        </h3>
        <span className="text-xs text-purple-300/60 font-medium">
          {quests.length} {quests.length === 1 ? "Quest" : "Quests"}
        </span>
      </div>

      {quests.length === 0 ? (
        <div className="rounded-xl border border-dashed border-purple-800/40 p-6 text-center space-y-2">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-purple-900/30 text-purple-400">
            <Compass className="h-5 w-5" />
          </div>
          <p className="text-xs font-medium text-purple-200">
            No expeditions recorded in your journal yet.
          </p>
          <p className="text-[11px] text-purple-300/60 max-w-xs mx-auto">
            Embark on your first adventure to discover secrets hidden around your neighborhood.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
          {quests.map((quest) => {
            const statusInfo = STATUS_CONFIG[quest.status] || {
              label: quest.status,
              badgeClass: "bg-slate-700/40 text-slate-300 border-slate-600/40",
              icon: null,
            };
            const isDemo = isSimulatedQuest(quest);

            return (
              <div
                key={quest.id}
                onClick={() => onSelectQuest(quest)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    onSelectQuest(quest);
                  }
                }}
                className="group flex items-center justify-between rounded-xl border border-purple-900/40 bg-purple-950/20 p-3.5 hover:border-purple-600/60 hover:bg-purple-900/30 transition cursor-pointer"
              >
                <div className="space-y-1 pr-2 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-white group-hover:text-amber-200 transition">
                      {quest.title}
                    </span>
                    {isDemo && (
                      <span className="rounded bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.2 text-[9px] font-bold text-amber-300">
                        Demo
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 text-[11px] text-purple-300/70 flex-wrap">
                    <span className="capitalize text-purple-200">{quest.difficulty}</span>
                    <span>•</span>
                    <span>{quest.estimated_minutes} min</span>
                    <span>•</span>
                    <span>{formatDate(quest.created_at)}</span>
                  </div>

                  {quest.status === "completed" && quest.destination_name ? (
                    <p className="text-[11px] text-emerald-400 font-medium">
                      Site: {quest.destination_name}
                    </p>
                  ) : quest.status === "active" ? (
                    <p className="text-[11px] text-purple-300 flex items-center gap-1">
                      <Lock className="h-3 w-3 text-amber-400/80" />
                      <span>Target site hidden until completion</span>
                    </p>
                  ) : null}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusInfo.badgeClass}`}
                  >
                    {statusInfo.icon}
                    {statusInfo.label}
                  </span>
                  <ChevronRight className="h-4 w-4 text-purple-400 group-hover:translate-x-0.5 transition" />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
