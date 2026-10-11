"use client";

import React, { useState } from "react";
import {
  X,
  Compass,
  Clock,
  Sparkles,
  MapPin,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Info,
} from "lucide-react";
import type {
  AvailableMinutesType,
  DifficultyType,
  ExplorerType,
  QuestCreateRequest,
} from "@/types/api";
import { getCurrentCoordinates, GeolocationError } from "@/lib/geo";

interface QuestSetupModalProps {
  userId: string;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (payload: QuestCreateRequest) => Promise<void>;
}

const EXPLORER_ARCHETYPES: Array<{
  id: ExplorerType;
  title: string;
  icon: string;
  desc: string;
}> = [
  {
    id: "mystery",
    title: "Mystery",
    icon: "🔮",
    desc: "Cryptic riddles and overlooked historical oddities",
  },
  {
    id: "discovery",
    title: "Discovery",
    icon: "🧭",
    desc: "Architectural landmarks, civic curiosities, and hidden art",
  },
  {
    id: "nature",
    title: "Nature",
    icon: "🌿",
    desc: "Gardens, botanical sanctuaries, and urban tree canopy walks",
  },
  {
    id: "fitness",
    title: "Fitness",
    icon: "⚡",
    desc: "Brisk scenic paths, stair climbs, and dynamic trail loops",
  },
  {
    id: "social",
    title: "Social",
    icon: "🤝",
    desc: "Bustling plazas, community gathering circles, and markets",
  },
];

const DURATIONS: AvailableMinutesType[] = [15, 30, 60];

const DIFFICULTIES: Array<{ id: DifficultyType; title: string; badge: string }> = [
  { id: "easy", title: "Easy", badge: "100 XP Base" },
  { id: "medium", title: "Medium", badge: "200 XP Base" },
  { id: "hard", title: "Hard", badge: "350 XP Base" },
];

export function QuestSetupModal({
  userId,
  isOpen,
  onClose,
  onSubmit,
}: QuestSetupModalProps) {
  const [duration, setDuration] = useState<AvailableMinutesType>(30);
  const [archetype, setArchetype] = useState<ExplorerType>("mystery");
  const [difficulty, setDifficulty] = useState<DifficultyType>("medium");

  const [geoState, setGeoState] = useState<{
    coords: { latitude: number; longitude: number; accuracy: number } | null;
    loading: boolean;
    error: string | null;
  }>({
    coords: null,
    loading: false,
    error: null,
  });

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  if (!isOpen) return null;

  async function handleAcquireLocation() {
    setGeoState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const coords = await getCurrentCoordinates();
      setGeoState({
        coords,
        loading: false,
        error: null,
      });
    } catch (err: unknown) {
      const msg =
        err instanceof GeolocationError
          ? err.message
          : (err as Error)?.message || "Failed to acquire GPS location.";
      setGeoState({
        coords: null,
        loading: false,
        error: msg,
      });
    }
  }

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    const payload: QuestCreateRequest = {
      user_id: userId,
      available_minutes: duration,
      explorer_type: archetype,
      difficulty: difficulty,
      latitude: geoState.coords?.latitude ?? null,
      longitude: geoState.coords?.longitude ?? null,
    };

    setSubmitting(true);
    try {
      await onSubmit(payload);
      onClose();
    } catch (err: unknown) {
      setSubmitError((err as Error)?.message || "Quest generation failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4 animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="setup-modal-title"
    >
      <div className="card-runic w-full max-w-lg rounded-t-3xl sm:rounded-3xl max-h-[92vh] overflow-y-auto border border-purple-600/40 shadow-2xl p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-purple-900/40 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-900/60 border border-purple-500/40 text-amber-400">
              <Compass className="h-5 w-5" />
            </div>
            <div>
              <h2 id="setup-modal-title" className="text-base font-bold text-white">
                Configure Expedition
              </h2>
              <p className="text-xs text-purple-300/70">
                AI Game Master will tailor your real-world quest
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg p-1.5 text-purple-400 hover:bg-purple-900/40 hover:text-white transition"
            aria-label="Close modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleGenerate} className="space-y-5">
          {/* 1. Duration */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-purple-200 flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-amber-400" />
              Available Time
            </label>
            <div className="grid grid-cols-3 gap-2">
              {DURATIONS.map((mins) => (
                <button
                  type="button"
                  key={mins}
                  onClick={() => setDuration(mins)}
                  className={`flex flex-col items-center justify-center rounded-xl py-3 border transition ${
                    duration === mins
                      ? "border-amber-400/80 bg-amber-500/20 text-amber-200 shadow-md shadow-amber-950/30"
                      : "border-purple-900/40 bg-purple-950/30 text-purple-300 hover:border-purple-700/60"
                  }`}
                >
                  <span className="text-sm font-bold">{mins} min</span>
                  <span className="text-[10px] text-purple-300/60">
                    {mins === 15 ? "Quick Sprint" : mins === 30 ? "Standard" : "Deep Trek"}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* 2. Archetype */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-purple-200 flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-amber-400" />
              Explorer Archetype
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {EXPLORER_ARCHETYPES.map((arch) => (
                <button
                  type="button"
                  key={arch.id}
                  onClick={() => setArchetype(arch.id)}
                  className={`flex items-start gap-2.5 rounded-xl p-3 text-left border transition ${
                    archetype === arch.id
                      ? "border-purple-500/80 bg-purple-800/30 text-white shadow-md shadow-purple-950/40"
                      : "border-purple-900/40 bg-purple-950/20 text-purple-300 hover:border-purple-700/60"
                  }`}
                >
                  <span className="text-xl" role="img" aria-label={arch.title}>
                    {arch.icon}
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-white">{arch.title}</p>
                    <p className="text-[10px] text-purple-300/70 truncate">{arch.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* 3. Difficulty */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-purple-200">Difficulty Rating</label>
            <div className="grid grid-cols-3 gap-2">
              {DIFFICULTIES.map((diff) => (
                <button
                  type="button"
                  key={diff.id}
                  onClick={() => setDifficulty(diff.id)}
                  className={`rounded-xl py-2.5 px-2 border text-center transition ${
                    difficulty === diff.id
                      ? "border-purple-400/80 bg-purple-600/25 text-white"
                      : "border-purple-900/40 bg-purple-950/30 text-purple-300 hover:border-purple-700/60"
                  }`}
                >
                  <p className="text-xs font-bold capitalize">{diff.title}</p>
                  <p className="text-[9px] text-purple-300/60">{diff.badge}</p>
                </button>
              ))}
            </div>
          </div>

          {/* 4. Location Permission & Coordinate Acquisition */}
          <div className="rounded-xl border border-purple-900/60 bg-purple-950/30 p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-purple-200 flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-amber-400" />
                Physical Location (GPS)
              </span>
              {geoState.coords ? (
                <span className="flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Acquired (±{Math.round(geoState.coords.accuracy)}m)
                </span>
              ) : (
                <span className="text-[11px] text-purple-300/60">Required for live quests</span>
              )}
            </div>

            {geoState.coords ? (
              <div className="rounded-lg bg-black/40 border border-purple-900/50 p-2.5 text-[11px] font-mono text-purple-200 flex justify-between items-center">
                <span>
                  {geoState.coords.latitude.toFixed(5)}, {geoState.coords.longitude.toFixed(5)}
                </span>
                <button
                  type="button"
                  onClick={handleAcquireLocation}
                  disabled={geoState.loading}
                  className="text-xs text-amber-300 hover:underline"
                >
                  Update
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleAcquireLocation}
                disabled={geoState.loading}
                className="w-full flex items-center justify-center gap-2 rounded-lg border border-purple-700/50 bg-purple-900/40 py-2.5 text-xs font-semibold text-purple-200 hover:bg-purple-800/40 transition disabled:opacity-50"
              >
                {geoState.loading ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />
                    <span>Acquiring Native GPS...</span>
                  </>
                ) : (
                  <>
                    <MapPin className="h-3.5 w-3.5 text-amber-400" />
                    <span>Acquire Current GPS Location</span>
                  </>
                )}
              </button>
            )}

            {geoState.error && (
              <div className="rounded-lg bg-red-950/40 border border-red-800/50 p-2.5 text-[11px] text-red-200 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                <p>{geoState.error}</p>
              </div>
            )}

            <div className="flex items-start gap-1.5 text-[10px] text-purple-300/60">
              <Info className="h-3 w-3 shrink-0 mt-0.5 text-purple-400" />
              <span>
                Simulated demo quests can be generated even without GPS. Live Google Places + Gemma
                mode strictly requires physical coordinates.
              </span>
            </div>
          </div>

          {/* Submit Error */}
          {submitError && (
            <div className="rounded-xl bg-red-950/50 border border-red-800/60 p-3 text-xs text-red-200 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
              <span>{submitError}</span>
            </div>
          )}

          {/* Primary Action Button */}
          <button
            type="submit"
            disabled={submitting}
            className="btn-primary-rpg w-full flex items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-bold text-white shadow-lg disabled:opacity-50 cursor-pointer"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-amber-300" />
                <span>Summoning Quest Narrative...</span>
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 text-amber-300" />
                <span>Summon Quest</span>
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
