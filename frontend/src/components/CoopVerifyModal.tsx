"use client";

import React, { useState } from "react";
import { MapPin, X, Loader2, Sparkles, AlertTriangle, ShieldCheck } from "lucide-react";
import { getCurrentCoordinates } from "@/lib/geo";
import type { PartyVerificationResponse } from "@/types/party";

interface CoopVerifyModalProps {
  partyId: string;
  isOpen: boolean;
  onClose: () => void;
  onVerify: (coords: { latitude: number; longitude: number }, answer: string) => Promise<PartyVerificationResponse>;
  onSuccess: (result: PartyVerificationResponse) => void;
}

export function CoopVerifyModal({
  isOpen,
  onClose,
  onVerify,
  onSuccess,
}: CoopVerifyModalProps) {
  const [answer, setAnswer] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [geoStatus, setGeoStatus] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!answer.trim()) {
      setErrorMessage("Please enter your observation answer.");
      return;
    }

    setErrorMessage(null);
    setVerifying(true);
    setGeoStatus("Acquiring high-accuracy GPS coordinates...");

    try {
      // Re-acquire GPS immediately before verification
      const loc = await getCurrentCoordinates();
      setGeoStatus("Verifying arrival and observation ground truth...");

      const result = await onVerify(
        { latitude: loc.latitude, longitude: loc.longitude },
        answer.trim()
      );

      onSuccess(result);
      onClose();
    } catch (err: unknown) {
      setErrorMessage((err as Error)?.message || "Verification failed. Ensure you are at the landmark.");
    } finally {
      setVerifying(false);
      setGeoStatus(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-md rounded-2xl border border-purple-800/60 bg-gradient-to-b from-[#19102c] to-[#0c0717] p-5 shadow-2xl space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-purple-900/60 pb-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/20 text-amber-300">
              <MapPin className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-purple-100">Cooperative Verification</h3>
              <p className="text-[11px] text-purple-300/70">Verify your physical presence at the landmark</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={verifying}
            className="rounded-lg p-1 text-purple-400 hover:bg-purple-900/40 hover:text-purple-200 transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-purple-200">
              Site Observation Answer
            </label>
            <p className="text-[11px] text-purple-300/60 leading-relaxed">
              Answer the site observation challenge based on the real-world marker or architectural feature.
            </p>
            <input
              type="text"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="e.g. owl, 1934, green bench..."
              disabled={verifying}
              className="w-full rounded-xl border border-purple-800/70 bg-purple-950/40 px-3 py-2 text-xs text-purple-100 placeholder-purple-500/60 focus:border-amber-500/70 focus:outline-none transition"
              autoFocus
            />
          </div>

          {/* Privacy Note */}
          <div className="rounded-xl border border-purple-900/50 bg-purple-950/30 p-2.5 flex items-start gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
            <p className="text-[10px] text-purple-300/70 leading-relaxed">
              Your GPS coordinates are securely evaluated on the server and are <span className="text-emerald-300 font-medium">never shared</span> with your partner.
            </p>
          </div>

          {/* Progress / Status */}
          {geoStatus && (
            <div className="flex items-center gap-2 text-xs text-amber-300/90 bg-amber-950/30 border border-amber-800/40 rounded-xl p-2.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>{geoStatus}</span>
            </div>
          )}

          {/* Error */}
          {errorMessage && (
            <div className="flex items-start gap-2 text-xs text-red-300 bg-red-950/40 border border-red-800/50 rounded-xl p-2.5">
              <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Buttons */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-purple-900/40">
            <button
              type="button"
              onClick={onClose}
              disabled={verifying}
              className="px-3 py-2 rounded-xl text-xs font-medium text-purple-300 hover:bg-purple-900/40 transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={verifying || !answer.trim()}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-xs font-semibold text-white shadow-lg shadow-amber-950/50 disabled:opacity-50 transition cursor-pointer"
            >
              {verifying ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Verifying...</span>
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>Submit Proof of Arrival</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
