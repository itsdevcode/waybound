"use client";

import React, { useState } from "react";
import { X, User, Check, Server, Sparkles } from "lucide-react";
import { DEFAULT_USER_ID, getActiveUserId, setActiveUserId } from "@/lib/api";

interface UserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUserChanged: (newUserId: string) => void;
}

export function UserModal({ isOpen, onClose, onUserChanged }: UserModalProps) {
  const [inputVal, setInputVal] = useState(getActiveUserId());
  const [savedMsg, setSavedMsg] = useState(false);

  if (!isOpen) return null;

  function handleSave(idToUse: string) {
    const cleanId = idToUse.trim();
    if (!cleanId) return;
    setActiveUserId(cleanId);
    setInputVal(cleanId);
    setSavedMsg(true);
    setTimeout(() => {
      setSavedMsg(false);
      onUserChanged(cleanId);
      onClose();
    }, 400);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="user-modal-title"
    >
      <div className="card-runic w-full max-w-md rounded-3xl border border-purple-600/40 shadow-2xl p-6 space-y-5">
        <div className="flex items-center justify-between border-b border-purple-900/40 pb-3">
          <div className="flex items-center gap-2">
            <User className="h-5 w-5 text-amber-400" />
            <h2 id="user-modal-title" className="text-sm font-bold text-white">
              Explorer Identity Configuration
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-purple-400 hover:text-white"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          <p className="text-xs text-purple-200/80 leading-relaxed">
            In Hackathon MVP mode, the backend uses caller-supplied Explorer UUIDs for deterministic session progression.
          </p>

          <div className="rounded-xl border border-purple-800/40 bg-purple-950/30 p-3 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-white">Seeded Demo Explorer</span>
              <span className="text-[10px] text-amber-300 font-bold uppercase">Ready</span>
            </div>
            <p className="text-[11px] text-purple-300/70 font-mono break-all">
              {DEFAULT_USER_ID}
            </p>
            <button
              onClick={() => handleSave(DEFAULT_USER_ID)}
              className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-purple-600/60 bg-purple-800/40 py-2 text-xs font-semibold text-purple-100 hover:bg-purple-700/40 transition"
            >
              <Sparkles className="h-3.5 w-3.5 text-amber-400" />
              <span>Use Seeded Demo Explorer</span>
            </button>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="custom-user-id" className="text-xs font-semibold text-purple-200">
              Or Enter Custom Explorer UUID
            </label>
            <input
              id="custom-user-id"
              type="text"
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              placeholder="e.g. 00000000-0000-0000-0000-000000000001"
              className="w-full rounded-xl border border-purple-800/60 bg-black/50 px-3.5 py-2.5 text-xs font-mono text-purple-100 focus:border-amber-400 focus:outline-none"
            />
          </div>

          <div className="rounded-lg bg-black/30 border border-purple-900/40 p-2.5 text-[11px] text-purple-300/70 flex items-center gap-2">
            <Server className="h-3.5 w-3.5 text-purple-400 shrink-0" />
            <span className="truncate">
              Target Backend:{" "}
              <code className="text-amber-300">
                {process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}
              </code>
            </span>
          </div>

          <button
            onClick={() => handleSave(inputVal)}
            className="btn-primary-rpg w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-bold text-white shadow-md cursor-pointer"
          >
            {savedMsg ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-300" />
                <span>Identity Switched!</span>
              </>
            ) : (
              <span>Save & Switch Identity</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
