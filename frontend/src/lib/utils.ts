import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { QuestResponse } from "@/types/api";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Backend leveling formula:
 * level = 1 + (xp // 500)
 */
export function calculateLevel(xp: number): number {
  return 1 + Math.floor(Math.max(0, xp) / 500);
}

export function getXpProgress(xp: number): {
  currentTierXp: number;
  tierTargetXp: number;
  progressPercent: number;
  xpUntilNext: number;
} {
  const safeXp = Math.max(0, xp);
  const currentTierXp = safeXp % 500;
  const tierTargetXp = 500;
  const progressPercent = Math.min(100, Math.floor((currentTierXp / tierTargetXp) * 100));
  const xpUntilNext = 500 - currentTierXp;

  return {
    currentTierXp,
    tierTargetXp,
    progressPercent,
    xpUntilNext,
  };
}

/**
 * Checks if a quest is generated under simulated demo mode.
 * Real-world and demo quests have strictly separated semantics.
 */
export function isSimulatedQuest(quest: QuestResponse | null | undefined): boolean {
  if (!quest) return false;
  if (quest.destination_name?.startsWith("[Simulated Demo]")) return true;
  if (quest.title?.toLowerCase().includes("simulated")) return true;
  if (quest.description?.toLowerCase().includes("simulated")) return true;
  if (quest.verification_prompt?.includes("[Simulated")) return true;
  if (quest.current_clues?.some((c) => c.clue.includes("[Simulated"))) return true;
  return false;
}

export function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return "N/A";
  try {
    const d = new Date(dateString);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateString;
  }
}
