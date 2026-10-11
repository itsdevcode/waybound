"use client";

import React from "react";
import { Volume2, VolumeX, Play, Pause, Square, RotateCcw } from "lucide-react";

interface NarrationControlsProps {
  trackId: string;
  textToNarrate: string;
  activeTrackId: string | null;
  isPlaying: boolean;
  isPaused: boolean;
  isMuted: boolean;
  isSupported: boolean;
  onPlay: (trackId: string, text: string) => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onReplay: () => void;
  variant?: "inline" | "prominent";
  label?: string;
}

export function NarrationControls({
  trackId,
  textToNarrate,
  activeTrackId,
  isPlaying,
  isPaused,
  isMuted,
  isSupported,
  onPlay,
  onPause,
  onResume,
  onStop,
  onReplay,
  variant = "inline",
  label = "Listen",
}: NarrationControlsProps) {
  const isThisTrackActive = activeTrackId === trackId;
  const isThisTrackPlaying = isThisTrackActive && isPlaying;

  if (!isSupported) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] text-purple-400/50 italic"
        title="Spoken audio is not supported by your current browser"
      >
        <VolumeX className="h-3 w-3" />
        <span className="sr-only">Speech narration unsupported in this browser</span>
      </span>
    );
  }

  if (isMuted) {
    return (
      <button
        disabled
        className="inline-flex items-center gap-1 text-[11px] text-purple-400/50 cursor-not-allowed opacity-60"
        title="Narration is currently muted"
        aria-label="Audio narration is muted"
      >
        <VolumeX className="h-3.5 w-3.5" />
        <span className="text-[10px]">Muted</span>
      </button>
    );
  }

  // Active playing / paused state for this snippet
  if (isThisTrackActive) {
    return (
      <div
        className={`flex items-center gap-1.5 ${
          variant === "prominent"
            ? "bg-purple-950/80 border border-purple-500/50 rounded-xl px-2.5 py-1 shadow-sm"
            : "bg-purple-900/40 rounded-lg px-2 py-0.5"
        }`}
        role="region"
        aria-label={`Audio controls for ${label}${isPaused ? " (paused)" : ""}`}
      >
        {/* Animated Audio Equalizer Wave (respects prefers-reduced-motion) */}
        {isThisTrackPlaying && (
          <div
            className="flex items-center gap-0.5 h-3.5 px-1 mr-0.5"
            aria-hidden="true"
          >
            <span className="w-0.5 h-3 bg-amber-400 rounded-full animate-pulse motion-reduce:animate-none" />
            <span className="w-0.5 h-4 bg-amber-300 rounded-full animate-bounce motion-reduce:animate-none" />
            <span className="w-0.5 h-2 bg-amber-400 rounded-full animate-pulse motion-reduce:animate-none" />
          </div>
        )}

        {isThisTrackPlaying ? (
          <button
            onClick={onPause}
            className="p-1 rounded text-amber-300 hover:text-white hover:bg-purple-800/60 transition"
            title="Pause narration"
            aria-label={`Pause narration for ${label}`}
          >
            <Pause className="h-3.5 w-3.5 fill-current" />
          </button>
        ) : (
          <button
            onClick={onResume}
            className="p-1 rounded text-amber-300 hover:text-white hover:bg-purple-800/60 transition"
            title="Resume narration"
            aria-label={`Resume narration for ${label}`}
          >
            <Play className="h-3.5 w-3.5 fill-current" />
          </button>
        )}

        <button
          onClick={onReplay}
          className="p-1 rounded text-purple-300 hover:text-amber-200 hover:bg-purple-800/60 transition"
          title="Replay from start"
          aria-label={`Replay narration for ${label}`}
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>

        <button
          onClick={onStop}
          className="p-1 rounded text-purple-300 hover:text-red-300 hover:bg-purple-800/60 transition"
          title="Stop narration"
          aria-label={`Stop narration for ${label}`}
        >
          <Square className="h-3 w-3 fill-current" />
        </button>
      </div>
    );
  }

  // Idle / not playing state
  if (variant === "prominent") {
    return (
      <button
        onClick={() => onPlay(trackId, textToNarrate)}
        className="flex items-center gap-1.5 rounded-xl border border-purple-700/50 bg-purple-900/40 hover:bg-purple-800/60 text-purple-200 hover:text-white px-3 py-1.5 text-xs font-semibold transition cursor-pointer shadow-sm group"
        aria-label={`Spoken narration: ${label}`}
      >
        <Volume2 className="h-4 w-4 text-amber-400 group-hover:scale-110 transition-transform motion-reduce:transform-none" />
        <span>{label}</span>
      </button>
    );
  }

  return (
    <button
      onClick={() => onPlay(trackId, textToNarrate)}
      className="flex items-center gap-1 text-[11px] font-semibold text-purple-300 hover:text-amber-300 transition cursor-pointer"
      title={`Listen to ${label}`}
      aria-label={`Listen to ${label}`}
    >
      <Volume2 className="h-3.5 w-3.5 text-amber-400" />
      <span>{label}</span>
    </button>
  );
}
