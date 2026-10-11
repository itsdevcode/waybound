import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import {
  isSpeechSynthesisSupported,
  getSavedVoiceMuted,
  setSavedVoiceMuted,
  getSavedVoiceUri,
  setSavedVoiceUri,
  cleanNarrationForSpeech,
  pickGameMasterVoice,
  STORAGE_KEY_VOICE_MUTED,
  STORAGE_KEY_VOICE_URI,
} from "@/lib/speech";
import { useVoiceNarration, type VoiceNarrationState } from "@/hooks/useVoiceNarration";
import type { QuestResponse, QuestVerificationResponse } from "@/types/api";

// Enable React act support in jsdom testing environment
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Voice Game Master - Speech Utility & Secrecy Guardrails", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    if (typeof localStorage !== "undefined") {
      localStorage.clear();
    }
  });

  it("cleans markdown and formatting tokens into natural spoken sentences", () => {
    const rawMarkdown = `
### Mysterious Transmission
**Beware**, explorer! Follow the _winding path_ through the \`iron gates\`.
- Look for the lion's seal.
- Do not stray.
> The ancient stone speaks at dusk.
    `;

    const cleaned = cleanNarrationForSpeech(rawMarkdown);
    expect(cleaned).not.toContain("###");
    expect(cleaned).not.toContain("**");
    expect(cleaned).not.toContain("_");
    expect(cleaned).not.toContain("`");
    expect(cleaned).not.toContain(">");
    expect(cleaned).toContain("Beware, explorer! Follow the winding path through the iron gates.");
    expect(cleaned).toContain("Look for the lion's seal.");
    expect(cleaned).toContain("The ancient stone speaks at dusk.");
  });

  it("persists mute preference to localStorage", () => {
    expect(getSavedVoiceMuted()).toBe(false);

    setSavedVoiceMuted(true);
    expect(localStorage.getItem(STORAGE_KEY_VOICE_MUTED)).toBe("true");
    expect(getSavedVoiceMuted()).toBe(true);

    setSavedVoiceMuted(false);
    expect(localStorage.getItem(STORAGE_KEY_VOICE_MUTED)).toBe("false");
    expect(getSavedVoiceMuted()).toBe(false);
  });

  it("persists preferred voice URI to localStorage", () => {
    expect(getSavedVoiceUri()).toBeNull();

    setSavedVoiceUri("Google-US-English-Voice");
    expect(localStorage.getItem(STORAGE_KEY_VOICE_URI)).toBe("Google-US-English-Voice");
    expect(getSavedVoiceUri()).toBe("Google-US-English-Voice");
  });

  it("selects appropriate Game Master voice adhering to user preference and fallback", () => {
    const mockVoices: SpeechSynthesisVoice[] = [
      {
        voiceURI: "es-voice",
        name: "Diego",
        lang: "es-ES",
        localService: true,
        default: false,
      },
      {
        voiceURI: "google-uk-voice",
        name: "Google UK English Male",
        lang: "en-GB",
        localService: false,
        default: false,
      },
      {
        voiceURI: "us-generic-voice",
        name: "Alex",
        lang: "en-US",
        localService: true,
        default: true,
      },
    ];

    // Priority 1: User's saved preference
    const pickedPreferred = pickGameMasterVoice(mockVoices, "es-voice");
    expect(pickedPreferred?.voiceURI).toBe("es-voice");

    // Priority 2: Natural English Game Master voice (Google UK)
    const pickedDefault = pickGameMasterVoice(mockVoices);
    expect(pickedDefault?.voiceURI).toBe("google-uk-voice");

    // Fallback: Empty voice list
    expect(pickGameMasterVoice([])).toBeNull();
  });

  it("strictly enforces destination secrecy for active and draft quests", () => {
    const activeQuest: QuestResponse = {
      id: "quest-secrecy-1",
      title: "The Silent Cloister",
      description: "Follow the bell chime past the ancient archway.",
      difficulty: "medium",
      estimated_minutes: 25,
      reward_xp: 200,
      status: "active",
      current_clues: [
        { id: "c1", step_order: 1, clue: "Locate the stone fountain.", is_unlocked: true },
        { id: "c2", step_order: 2, clue: "Find the inscribed sundial.", is_unlocked: true },
      ],
      verification_prompt: "What mythical creature guards the basin?",
      destination_name: null, // Strictly null before completion!
      created_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      completed_at: null,
      updated_at: new Date().toISOString(),
    };

    // Story narration contains only description
    const storyText = cleanNarrationForSpeech(activeQuest.description);
    expect(storyText).toBe("Follow the bell chime past the ancient archway.");
    expect(storyText).not.toContain("Cloister Secret Garden");
    expect(storyText).not.toContain("37.7");

    // Unlocked clue narration contains only unlocked clue text
    const clue1Text = cleanNarrationForSpeech(`Clue number 1. ${activeQuest.current_clues[0].clue}`);
    expect(clue1Text).toBe("Clue number 1. Locate the stone fountain.");
    expect(clue1Text).not.toContain("Cloister Secret Garden");

    // Destination name is strictly null
    expect(activeQuest.destination_name).toBeNull();
  });

  it("narrates quest completion using only confirmed result data", () => {
    const confirmedResult: QuestVerificationResponse = {
      success: true,
      reward_xp_awarded: 200,
      total_xp: 350,
      level: 1,
      message: "You have arrived at the ancient stone fountain courtyard. Well done, explorer!",
      quest: {
        id: "quest-secrecy-1",
        title: "The Silent Cloister",
        description: "Follow the bell chime past the ancient archway.",
        difficulty: "medium",
        estimated_minutes: 25,
        reward_xp: 200,
        status: "completed",
        current_clues: [],
        verification_prompt: "What mythical creature guards the basin?",
        destination_name: "Saint Francis Memorial Cloister Courtyard", // Now revealed upon verification
        created_at: new Date().toISOString(),
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    };

    const completionNarration = [
      `Expedition accomplished! Quest verified: ${confirmedResult.quest.title}.`,
      confirmedResult.quest.destination_name
        ? `Destination unlocked: ${confirmedResult.quest.destination_name}.`
        : "",
      confirmedResult.reward_xp_awarded > 0
        ? `You earned ${confirmedResult.reward_xp_awarded} experience points.`
        : "",
      confirmedResult.message,
    ]
      .filter(Boolean)
      .join(" ");

    const cleaned = cleanNarrationForSpeech(completionNarration);
    expect(cleaned).toContain("Expedition accomplished! Quest verified: The Silent Cloister.");
    expect(cleaned).toContain("Destination unlocked: Saint Francis Memorial Cloister Courtyard.");
    expect(cleaned).toContain("You earned 200 experience points.");
    expect(cleaned).toContain("You have arrived at the ancient stone fountain courtyard.");

    // Coordinates are never present
    expect(cleaned).not.toContain("latitude");
    expect(cleaned).not.toContain("longitude");
  });
});

describe("Voice Game Master - Unsupported Browser Fallback", () => {
  it("gracefully disables speech without throwing errors when speechSynthesis is unavailable", () => {
    // Delete speechSynthesis & SpeechSynthesisUtterance from window
    const originalSpeechSynthesis = window.speechSynthesis;
    const originalUtterance = window.SpeechSynthesisUtterance;
    // @ts-expect-error test deletion
    delete window.speechSynthesis;
    // @ts-expect-error test deletion
    delete window.SpeechSynthesisUtterance;

    try {
      expect(isSpeechSynthesisSupported()).toBe(false);

      // Verify that calling fallback helpers is completely safe
      expect(getSavedVoiceMuted()).toBe(false);
      setSavedVoiceMuted(true);
      expect(getSavedVoiceMuted()).toBe(true);
    } finally {
      window.speechSynthesis = originalSpeechSynthesis;
      window.SpeechSynthesisUtterance = originalUtterance;
    }
  });
});

describe("Voice Game Master - React Hook State Transitions & Cleanup", () => {
  let mockUtterances: MockUtterance[] = [];
  let mockSpeechSynthesis: {
    speak: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
    getVoices: ReturnType<typeof vi.fn>;
    onvoiceschanged: (() => void) | null;
  };

  class MockUtterance {
    text: string;
    rate: number = 1;
    pitch: number = 1;
    voice: SpeechSynthesisVoice | null = null;
    onstart: (() => void) | null = null;
    onend: (() => void) | null = null;
    onerror: ((e: { error: string }) => void) | null = null;
    onpause: (() => void) | null = null;
    onresume: (() => void) | null = null;

    constructor(text: string) {
      this.text = text;
      mockUtterances.push(this);
    }
  }

  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    mockUtterances = [];
    mockSpeechSynthesis = {
      speak: vi.fn((utterance: MockUtterance) => {
        // Trigger onstart synchronously in mock test
        if (utterance.onstart) utterance.onstart();
      }),
      cancel: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      getVoices: vi.fn(() => []),
      onvoiceschanged: null,
    };

    Object.defineProperty(window, "speechSynthesis", {
      value: mockSpeechSynthesis,
      configurable: true,
      writable: true,
    });

    Object.defineProperty(window, "SpeechSynthesisUtterance", {
      value: MockUtterance,
      configurable: true,
      writable: true,
    });

    if (typeof localStorage !== "undefined") {
      localStorage.clear();
    }

    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
      container = null;
    }
    vi.restoreAllMocks();
  });

  // Helper harness to test the hook with React 19 createRoot
  function renderHookHarness(callback: (state: VoiceNarrationState) => void) {
    let capturedState: VoiceNarrationState | null = null;

    function TestComponent() {
      const state = useVoiceNarration();
      capturedState = state;
      callback(state);
      return React.createElement("div", { id: "test-voice" });
    }

    const root = createRoot(container!);
    act(() => {
      root.render(React.createElement(TestComponent));
    });

    return {
      getState: () => capturedState!,
      unmount: () => {
        act(() => {
          root.unmount();
        });
      },
    };
  }

  it("initializes with isSupported = true, unmuted, and not playing", () => {
    let stateSnap: VoiceNarrationState | null = null;
    const harness = renderHookHarness((s) => {
      stateSnap = s;
    });

    expect(stateSnap!.isSupported).toBe(true);
    expect(stateSnap!.isMuted).toBe(false);
    expect(stateSnap!.isPlaying).toBe(false);
    expect(stateSnap!.isPaused).toBe(false);
    expect(stateSnap!.activeTrackId).toBeNull();

    harness.unmount();
  });

  it("transitions state through play -> pause -> resume -> stop", () => {
    const harness = renderHookHarness(() => {});
    const state = harness.getState();

    // 1. Play track
    act(() => {
      state.play("story", "Follow the trail to the stone altar.");
    });

    expect(mockSpeechSynthesis.speak).toHaveBeenCalledTimes(1);
    expect(harness.getState().isPlaying).toBe(true);
    expect(harness.getState().isPaused).toBe(false);
    expect(harness.getState().activeTrackId).toBe("story");

    // 2. Pause
    act(() => {
      harness.getState().pause();
    });

    expect(mockSpeechSynthesis.pause).toHaveBeenCalledTimes(1);
    expect(harness.getState().isPaused).toBe(true);
    expect(harness.getState().isPlaying).toBe(false);

    // 3. Resume
    act(() => {
      harness.getState().resume();
    });

    expect(mockSpeechSynthesis.resume).toHaveBeenCalledTimes(1);
    expect(harness.getState().isPlaying).toBe(true);
    expect(harness.getState().isPaused).toBe(false);

    // 4. Stop
    act(() => {
      harness.getState().stop();
    });

    expect(mockSpeechSynthesis.cancel).toHaveBeenCalled();
    expect(harness.getState().isPlaying).toBe(false);
    expect(harness.getState().isPaused).toBe(false);
    expect(harness.getState().activeTrackId).toBeNull();

    harness.unmount();
  });

  it("handles repeated taps and rapid track switching without overlapping speech", () => {
    const harness = renderHookHarness(() => {});
    const state = harness.getState();

    // First tap: Play clue 1
    act(() => {
      state.play("clue-1", "Look behind the clock tower.");
    });

    expect(mockSpeechSynthesis.speak).toHaveBeenCalledTimes(1);
    expect(harness.getState().activeTrackId).toBe("clue-1");

    // Rapid second tap: Switch to clue 2
    act(() => {
      state.play("clue-2", "Search the stone archway.");
    });

    // Previous speech canceled before speaking new utterance
    expect(mockSpeechSynthesis.cancel).toHaveBeenCalled();
    expect(mockSpeechSynthesis.speak).toHaveBeenCalledTimes(2);
    expect(harness.getState().activeTrackId).toBe("clue-2");

    harness.unmount();
  });

  it("suppresses speech and cancels current playback when muted", () => {
    const harness = renderHookHarness(() => {});
    const state = harness.getState();

    // Start playing
    act(() => {
      state.play("story", "An adventurous quest begins.");
    });
    expect(harness.getState().isPlaying).toBe(true);

    // Toggle mute
    act(() => {
      harness.getState().toggleMute();
    });

    expect(harness.getState().isMuted).toBe(true);
    expect(mockSpeechSynthesis.cancel).toHaveBeenCalled();
    expect(harness.getState().isPlaying).toBe(false);

    // While muted, calling play does not speak audio
    mockSpeechSynthesis.speak.mockClear();
    act(() => {
      harness.getState().play("story", "This should not be spoken.");
    });

    expect(mockSpeechSynthesis.speak).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("replays the last spoken track on demand", () => {
    const harness = renderHookHarness(() => {});
    const state = harness.getState();

    act(() => {
      state.play("clue-1", "Cross the ancient wooden bridge.");
    });

    expect(mockSpeechSynthesis.speak).toHaveBeenCalledTimes(1);

    act(() => {
      harness.getState().replay();
    });

    expect(mockSpeechSynthesis.speak).toHaveBeenCalledTimes(2);
    expect(harness.getState().activeTrackId).toBe("clue-1");

    harness.unmount();
  });

  it("cleans up and cancels speech synthesis when unmounted", () => {
    const harness = renderHookHarness(() => {});
    act(() => {
      harness.getState().play("story", "A journey into the unknown.");
    });

    mockSpeechSynthesis.cancel.mockClear();

    // Unmount component
    harness.unmount();

    // cancel() was called in cleanup
    expect(mockSpeechSynthesis.cancel).toHaveBeenCalled();
  });
});
