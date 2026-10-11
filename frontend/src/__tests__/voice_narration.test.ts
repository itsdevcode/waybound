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
import { speechController } from "@/lib/speechController";
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
    speechController.resetForTesting();
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
        destination_name: "Saint Francis Memorial Cloister Courtyard", // Revealed upon verification
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
    const originalSpeechSynthesis = window.speechSynthesis;
    const originalUtterance = window.SpeechSynthesisUtterance;
    // @ts-expect-error test deletion
    delete window.speechSynthesis;
    // @ts-expect-error test deletion
    delete window.SpeechSynthesisUtterance;

    try {
      expect(isSpeechSynthesisSupported()).toBe(false);
      expect(getSavedVoiceMuted()).toBe(false);
      setSavedVoiceMuted(true);
      expect(getSavedVoiceMuted()).toBe(true);
    } finally {
      window.speechSynthesis = originalSpeechSynthesis;
      window.SpeechSynthesisUtterance = originalUtterance;
    }
  });
});

describe("Voice Game Master - React Hook State Transitions & Hardened Concurrency", () => {
  let mockUtterances: MockUtterance[] = [];
  let mockSpeechSynthesis: {
    speak: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
    getVoices: ReturnType<typeof vi.fn>;
    addEventListener: ReturnType<typeof vi.fn>;
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

  let containers: HTMLDivElement[] = [];

  beforeEach(() => {
    mockUtterances = [];
    mockSpeechSynthesis = {
      speak: vi.fn((utterance: MockUtterance) => {
        // Trigger onstart synchronously by default in tests
        if (utterance.onstart) utterance.onstart();
      }),
      cancel: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      getVoices: vi.fn(() => []),
      addEventListener: vi.fn(),
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

    speechController.resetForTesting();
    containers = [];
  });

  afterEach(() => {
    containers.forEach((c) => {
      if (c && c.parentNode) {
        c.parentNode.removeChild(c);
      }
    });
    containers = [];
    vi.restoreAllMocks();
  });

  function renderHookHarness(ownerId?: string) {
    let capturedState: VoiceNarrationState | null = null;

    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);

    function TestComponent() {
      const state = useVoiceNarration(ownerId);
      capturedState = state;
      return React.createElement("div", { id: ownerId || "test-voice" });
    }

    const root = createRoot(container);
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
    const harness = renderHookHarness();
    const state = harness.getState();

    expect(state.isSupported).toBe(true);
    expect(state.isMuted).toBe(false);
    expect(state.isPlaying).toBe(false);
    expect(state.isPaused).toBe(false);
    expect(state.activeTrackId).toBeNull();

    harness.unmount();
  });

  it("transitions state smoothly through play -> pause -> resume -> stop", () => {
    const harness = renderHookHarness();

    // 1. Play track
    act(() => {
      harness.getState().play("story", "Follow the trail to the stone altar.");
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
    const harness = renderHookHarness();

    // First tap: Play clue 1
    act(() => {
      harness.getState().play("clue-1", "Look behind the clock tower.");
    });

    expect(mockSpeechSynthesis.speak).toHaveBeenCalledTimes(1);
    expect(harness.getState().activeTrackId).toBe("clue-1");

    // Rapid second tap: Switch to clue 2
    act(() => {
      harness.getState().play("clue-2", "Search the stone archway.");
    });

    expect(mockSpeechSynthesis.cancel).toHaveBeenCalled();
    expect(mockSpeechSynthesis.speak).toHaveBeenCalledTimes(2);
    expect(harness.getState().activeTrackId).toBe("clue-2");

    harness.unmount();
  });

  it("guards against stale asynchronous utterance callbacks from canceled speech", () => {
    // Configure mock to NOT automatically fire onstart synchronously
    mockSpeechSynthesis.speak = vi.fn();

    const harness = renderHookHarness();

    // 1. Play track 1
    act(() => {
      harness.getState().play("track-1", "First ancient inscription.");
    });
    const utterance1 = mockUtterances[0];
    act(() => {
      if (utterance1.onstart) utterance1.onstart();
    });
    expect(harness.getState().activeTrackId).toBe("track-1");
    expect(harness.getState().isPlaying).toBe(true);

    // 2. Rapidly switch to track 2
    act(() => {
      harness.getState().play("track-2", "Second ancient inscription.");
    });
    const utterance2 = mockUtterances[1];
    act(() => {
      if (utterance2.onstart) utterance2.onstart();
    });
    expect(harness.getState().activeTrackId).toBe("track-2");

    // 3. Now simulate delayed 'onend' or 'onerror' event arriving from canceled Utterance 1
    act(() => {
      if (utterance1.onend) utterance1.onend();
      if (utterance1.onerror) utterance1.onerror({ error: "interrupted" });
    });

    // Utterance 1's stale callbacks MUST be ignored; track 2 must still be actively playing!
    expect(harness.getState().activeTrackId).toBe("track-2");
    expect(harness.getState().isPlaying).toBe(true);

    // 4. When Utterance 2 finishes, state resets cleanly
    act(() => {
      if (utterance2.onend) utterance2.onend();
    });
    expect(harness.getState().activeTrackId).toBeNull();
    expect(harness.getState().isPlaying).toBe(false);

    harness.unmount();
  });

  it("simultaneous hook instances: unmounting instance B does NOT cancel instance A's active speech", () => {
    // Harness A: represents ActiveQuestView
    const harnessA = renderHookHarness("quest-view");
    // Harness B: represents QuestCompleteModal
    const harnessB = renderHookHarness("complete-modal");

    // Harness A starts playing quest story
    act(() => {
      harnessA.getState().play("quest-story", "A forgotten tomb awakens.");
    });

    expect(harnessA.getState().isPlaying).toBe(true);
    expect(harnessB.getState().isPlaying).toBe(true);
    expect(harnessA.getState().activeTrackId).toBe("quest-story");

    mockSpeechSynthesis.cancel.mockClear();

    // Harness B (e.g. modal) unmounts
    harnessB.unmount();

    // speechSynthesis.cancel MUST NOT be called because Harness B did not own the speech!
    expect(mockSpeechSynthesis.cancel).not.toHaveBeenCalled();
    expect(harnessA.getState().isPlaying).toBe(true);
    expect(harnessA.getState().activeTrackId).toBe("quest-story");

    // When Harness A unmounts, speech IS stopped
    harnessA.unmount();
    expect(mockSpeechSynthesis.cancel).toHaveBeenCalled();
  });

  it("synchronizes mute state and voice preference changes across all hook instances", () => {
    const harnessA = renderHookHarness("instance-a");
    const harnessB = renderHookHarness("instance-b");

    expect(harnessA.getState().isMuted).toBe(false);
    expect(harnessB.getState().isMuted).toBe(false);

    // Instance A toggles mute
    act(() => {
      harnessA.getState().toggleMute();
    });

    // Instance B reflects mute immediately
    expect(harnessA.getState().isMuted).toBe(true);
    expect(harnessB.getState().isMuted).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY_VOICE_MUTED)).toBe("true");

    // Provide mock voices
    const mockVoiceList: SpeechSynthesisVoice[] = [
      {
        voiceURI: "heroic-gm-voice",
        name: "Arthur Game Master",
        lang: "en-US",
        localService: true,
        default: false,
      },
    ];

    // Trigger voices on controller
    act(() => {
      mockSpeechSynthesis.getVoices = vi.fn(() => mockVoiceList);
      speechController.loadVoices();
      harnessA.getState().selectVoice("heroic-gm-voice");
    });

    // Both instances receive selected voice
    expect(harnessA.getState().selectedVoice?.voiceURI).toBe("heroic-gm-voice");
    expect(harnessB.getState().selectedVoice?.voiceURI).toBe("heroic-gm-voice");

    harnessA.unmount();
    harnessB.unmount();
  });

  it("replays the last spoken track on demand", () => {
    const harness = renderHookHarness();

    act(() => {
      harness.getState().play("clue-1", "Cross the ancient wooden bridge.");
    });

    expect(mockSpeechSynthesis.speak).toHaveBeenCalledTimes(1);

    act(() => {
      harness.getState().replay();
    });

    expect(mockSpeechSynthesis.speak).toHaveBeenCalledTimes(2);
    expect(harness.getState().activeTrackId).toBe("clue-1");

    harness.unmount();
  });
});
