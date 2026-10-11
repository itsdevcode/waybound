"use client";

import React, { useState } from "react";
import {
  Compass,
  Mail,
  KeyRound,
  Sparkles,
  ArrowRight,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Shield,
  LogOut,
} from "lucide-react";
import { api, getAuthToken } from "@/lib/api";
import type { SessionResponse } from "@/types/party";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthenticated: (session: SessionResponse) => void;
  onLogout?: () => void;
  currentEmail?: string | null;
}

export function AuthModal({
  isOpen,
  onClose,
  onAuthenticated,
  onLogout,
  currentEmail,
}: AuthModalProps) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [simulatedCode, setSimulatedCode] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const hasActiveSession = !!getAuthToken();

  async function handleRequestOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    setSimulatedCode(null);

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }

    setLoading(true);
    try {
      const res = await api.auth.requestOtp(cleanEmail);
      setSuccessMsg(res.message || "Verification code dispatched to your inbox.");
      if (res.simulated_code) {
        setSimulatedCode(res.simulated_code);
        setCode(res.simulated_code);
      }
      setStep("code");
    } catch (err: unknown) {
      setError((err as Error)?.message || "Failed to dispatch verification code. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    const cleanEmail = email.trim().toLowerCase();
    const cleanCode = code.trim();
    if (!cleanCode || cleanCode.length < 4) {
      setError("Please enter the verification code.");
      return;
    }

    setLoading(true);
    try {
      const session = await api.auth.verifyOtp(cleanEmail, cleanCode);
      onAuthenticated(session);
      onClose();
    } catch (err: unknown) {
      setError((err as Error)?.message || "Invalid or expired verification code.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSignOut() {
    setLoading(true);
    try {
      await api.auth.logout();
      if (onLogout) onLogout();
      onClose();
    } catch {
      if (onLogout) onLogout();
      onClose();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      <div className="card-runic w-full max-w-md rounded-3xl border border-purple-500/50 shadow-2xl p-6 sm:p-7 space-y-5 bg-[#0e091a]">
        {/* Modal Header */}
        <div className="flex items-start justify-between border-b border-purple-900/40 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-700 to-indigo-900 border border-purple-400/40 shadow-inner text-amber-300">
              <Compass className="h-5 w-5 animate-[spin_20s_linear_infinite]" />
            </div>
            <div>
              <h2 id="auth-modal-title" className="text-base font-extrabold text-white tracking-wide">
                {hasActiveSession ? "Explorer Account" : "Join the Exploration"}
              </h2>
              <p className="text-xs text-purple-300/70">
                {hasActiveSession
                  ? "Manage your active authenticated explorer identity"
                  : "Passwordless sign-in with verified email OTP"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-purple-400 hover:text-white hover:bg-purple-900/40 transition cursor-pointer"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* If user already authenticated: Show status & sign out */}
        {hasActiveSession ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-purple-800/50 bg-purple-950/40 p-4 space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-emerald-300">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                <span>Authenticated Explorer</span>
              </div>
              {currentEmail && (
                <p className="text-xs text-purple-200 font-mono break-all">{currentEmail}</p>
              )}
              <p className="text-[11px] text-purple-300/60 leading-relaxed">
                Your journey, unlocked clues, progression level, and XP are securely synchronized.
              </p>
            </div>

            <button
              onClick={handleSignOut}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 rounded-xl border border-red-800/60 bg-red-950/40 py-2.5 text-xs font-bold text-red-200 hover:bg-red-900/40 transition cursor-pointer disabled:opacity-50"
            >
              <LogOut className="h-4 w-4" />
              <span>Sign Out of Explorer Account</span>
            </button>
          </div>
        ) : (
          /* Authentication Flow: Step 1 (Email) or Step 2 (Code) */
          <div>
            {step === "email" ? (
              <form onSubmit={handleRequestOtp} className="space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="auth-email-input" className="text-xs font-semibold text-purple-200 flex items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5 text-amber-400" />
                    Explorer Email Address
                  </label>
                  <input
                    id="auth-email-input"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="explorer@domain.com"
                    autoComplete="email"
                    className="w-full rounded-xl border border-purple-800/60 bg-black/60 px-3.5 py-3 text-sm text-purple-100 placeholder:text-purple-400/40 focus:border-amber-400 focus:outline-none transition"
                  />
                  <p className="text-[11px] text-purple-300/60 leading-relaxed">
                    We will send a 6-digit verification code. First-time explorers will automatically have an adventurer profile created.
                  </p>
                </div>

                {error && (
                  <div className="rounded-xl border border-red-800/60 bg-red-950/50 p-3 text-xs text-red-200 flex items-start gap-2 animate-in fade-in">
                    <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="btn-primary-rpg w-full flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-white shadow-lg disabled:opacity-50 cursor-pointer"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin text-amber-300" />
                      <span>Sending Code...</span>
                    </>
                  ) : (
                    <>
                      <span>Continue with Email</span>
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </button>
              </form>
            ) : (
              <form onSubmit={handleVerifyOtp} className="space-y-4">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label htmlFor="auth-code-input" className="text-xs font-semibold text-purple-200 flex items-center gap-1.5">
                      <KeyRound className="h-3.5 w-3.5 text-amber-400" />
                      Enter 6-Digit Code
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setStep("email");
                        setError(null);
                      }}
                      className="text-[11px] text-amber-300 hover:underline cursor-pointer"
                    >
                      Change email
                    </button>
                  </div>

                  <input
                    id="auth-code-input"
                    type="text"
                    required
                    maxLength={10}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="123456"
                    className="w-full text-center tracking-[0.25em] font-mono text-lg rounded-xl border border-purple-800/60 bg-black/60 px-3.5 py-2.5 text-amber-300 focus:border-amber-400 focus:outline-none transition"
                  />

                  <p className="text-[11px] text-purple-300/60">
                    Sent to <span className="font-semibold text-purple-200">{email}</span>. Valid for 10 minutes.
                  </p>
                </div>

                {simulatedCode && (
                  <div className="rounded-xl border border-amber-600/50 bg-amber-950/40 p-2.5 text-xs text-amber-200 flex items-center justify-between">
                    <span>Dev/Test Code: <strong className="font-mono text-amber-300">{simulatedCode}</strong></span>
                    <button
                      type="button"
                      onClick={() => setCode(simulatedCode)}
                      className="text-[11px] underline text-amber-300 font-semibold cursor-pointer"
                    >
                      Autofill
                    </button>
                  </div>
                )}

                {successMsg && !error && (
                  <div className="rounded-xl border border-emerald-800/60 bg-emerald-950/40 p-2.5 text-xs text-emerald-200 flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                    <span>{successMsg}</span>
                  </div>
                )}

                {error && (
                  <div className="rounded-xl border border-red-800/60 bg-red-950/50 p-3 text-xs text-red-200 flex items-start gap-2 animate-in fade-in">
                    <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="btn-primary-rpg w-full flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-white shadow-lg disabled:opacity-50 cursor-pointer"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin text-amber-300" />
                      <span>Verifying Code...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4 text-amber-300" />
                      <span>Complete & Enter Waybound</span>
                    </>
                  )}
                </button>
              </form>
            )}

            {/* Privacy & Guarantee note */}
            <div className="pt-2 border-t border-purple-900/40 flex items-center gap-2 text-[10px] text-purple-300/60">
              <Shield className="h-3.5 w-3.5 text-purple-400 shrink-0" />
              <span>Secure passwordless authentication with zero spam guarantee.</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
