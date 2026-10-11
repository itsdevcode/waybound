"use client";

import React, { useState } from "react";
import {
  X,
  MapPin,
  Eye,
  AlertTriangle,
  Loader2,
  CheckCircle2,
  Info,
} from "lucide-react";
import type { QuestResponse, QuestVerificationResponse, QuestVerifyRequest } from "@/types/api";
import { getCurrentCoordinates, GeolocationError } from "@/lib/geo";

interface QuestVerifyModalProps {
  quest: QuestResponse;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (result: QuestVerificationResponse) => void;
  onVerify: (payload: QuestVerifyRequest) => Promise<QuestVerificationResponse>;
}

export function QuestVerifyModal({
  quest,
  isOpen,
  onClose,
  onSuccess,
  onVerify,
}: QuestVerifyModalProps) {
  const [answer, setAnswer] = useState("");
  const [coords, setCoords] = useState<{
    latitude: number;
    longitude: number;
    accuracy: number;
  } | null>(null);

  const [acquiringLocation, setAcquiringLocation] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  if (!isOpen) return null;

  async function handleAcquireLocation() {
    setLocationError(null);
    setAcquiringLocation(true);
    try {
      const pos = await getCurrentCoordinates();
      setCoords(pos);
    } catch (err: unknown) {
      const msg =
        err instanceof GeolocationError
          ? err.message
          : (err as Error)?.message || "Failed to acquire GPS location.";
      setLocationError(msg);
      setCoords(null);
    } finally {
      setAcquiringLocation(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setVerifyError(null);

    if (!coords) {
      setVerifyError("You must acquire your current physical GPS coordinates to verify arrival.");
      return;
    }

    if (!answer.trim()) {
      setVerifyError("Please enter your observation answer from the physical location.");
      return;
    }

    setVerifying(true);
    try {
      const result = await onVerify({
        latitude: coords.latitude,
        longitude: coords.longitude,
        observation_answer: answer.trim(),
      });
      onSuccess(result);
      onClose();
    } catch (err: unknown) {
      setVerifyError(
        (err as Error)?.message ||
          "Verification failed. Ensure you are physically at the landmark and the observation answer is correct."
      );
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4 animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="verify-modal-title"
    >
      <div className="card-runic w-full max-w-lg rounded-t-3xl sm:rounded-3xl max-h-[92vh] overflow-y-auto border border-amber-500/40 shadow-2xl p-6 space-y-5">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-purple-900/40 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-300">
              <MapPin className="h-5 w-5" />
            </div>
            <div>
              <h2 id="verify-modal-title" className="text-base font-bold text-white">
                Verify Arrival & Observation
              </h2>
              <p className="text-xs text-purple-300/70">
                Confirm your physical presence at the secret destination
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={verifying}
            className="rounded-lg p-1.5 text-purple-400 hover:bg-purple-900/40 hover:text-white transition"
            aria-label="Close modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Observation Challenge Prompt */}
          <div className="card-runic-gold rounded-2xl p-4 space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold text-amber-300">
              <Eye className="h-4 w-4" />
              Required Field Observation
            </div>
            <p className="text-xs text-amber-100/90 leading-relaxed font-sans">
              {quest.verification_prompt ||
                "Inspect the secret destination and answer the site observation challenge."}
            </p>
          </div>

          {/* Observation Answer Input */}
          <div className="space-y-1.5">
            <label
              htmlFor="observation-answer-input"
              className="text-xs font-semibold text-purple-200"
            >
              Your Site Observation Answer
            </label>
            <input
              id="observation-answer-input"
              type="text"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="e.g. owl, 1934, green..."
              required
              disabled={verifying}
              className="w-full rounded-xl border border-purple-800/60 bg-black/50 px-3.5 py-3 text-sm text-white placeholder-purple-400/40 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400/50"
            />
          </div>

          {/* Geolocation Section */}
          <div className="rounded-xl border border-purple-900/60 bg-purple-950/30 p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-purple-200 flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-amber-400" />
                Physical Proximity Verification
              </span>
              {coords ? (
                <span className="flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Locked (±{Math.round(coords.accuracy)}m)
                </span>
              ) : (
                <span className="text-[11px] text-amber-300/80 font-medium">Required</span>
              )}
            </div>

            {coords ? (
              <div className="rounded-lg bg-black/40 border border-purple-900/50 p-2.5 text-[11px] font-mono text-purple-200 flex justify-between items-center">
                <span>
                  {coords.latitude.toFixed(5)}, {coords.longitude.toFixed(5)}
                </span>
                <button
                  type="button"
                  onClick={handleAcquireLocation}
                  disabled={acquiringLocation || verifying}
                  className="text-xs text-amber-300 hover:underline"
                >
                  Re-check
                </button>
              </div>
            ) : (
              <button
                type="button"
                id="acquire-verify-gps-btn"
                onClick={handleAcquireLocation}
                disabled={acquiringLocation || verifying}
                className="w-full flex items-center justify-center gap-2 rounded-lg border border-amber-500/50 bg-amber-500/15 py-2.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/25 transition disabled:opacity-50"
              >
                {acquiringLocation ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />
                    <span>Acquiring Native GPS...</span>
                  </>
                ) : (
                  <>
                    <MapPin className="h-3.5 w-3.5 text-amber-400" />
                    <span>Capture Current Verification GPS</span>
                  </>
                )}
              </button>
            )}

            {locationError && (
              <div className="rounded-lg bg-red-950/40 border border-red-800/50 p-2.5 text-[11px] text-red-200 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                <span>{locationError}</span>
              </div>
            )}

            <div className="flex items-start gap-1.5 text-[10px] text-purple-300/60">
              <Info className="h-3 w-3 shrink-0 mt-0.5 text-purple-400" />
              <span>
                Backend verifies you are within target geofence range (&le;100m) of the actual site.
              </span>
            </div>
          </div>

          {/* Verification Error */}
          {verifyError && (
            <div className="rounded-xl bg-red-950/50 border border-red-800/60 p-3 text-xs text-red-200 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
              <span>{verifyError}</span>
            </div>
          )}

          {/* Submit Verification Button */}
          <button
            type="submit"
            id="submit-verification-btn"
            disabled={verifying || !coords || !answer.trim()}
            className="btn-gold-rpg w-full flex items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-bold shadow-lg disabled:opacity-50 cursor-pointer"
          >
            {verifying ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-amber-950" />
                <span>Verifying Proximity & Clues...</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4 text-amber-950" />
                <span>Submit & Complete Quest</span>
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
