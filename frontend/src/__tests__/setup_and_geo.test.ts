import { describe, it, expect, vi, beforeEach } from "vitest";
import { getCurrentCoordinates, GeolocationError } from "@/lib/geo";
import { calculateLevel, getXpProgress, isSimulatedQuest } from "@/lib/utils";
import type { QuestResponse } from "@/types/api";

describe("Geolocation & Safety Guardrails", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("handles insecure context without faking coordinates", async () => {
    Object.defineProperty(window, "isSecureContext", {
      value: false,
      configurable: true,
    });

    await expect(getCurrentCoordinates()).rejects.toThrowError(GeolocationError);
    await expect(getCurrentCoordinates()).rejects.toMatchObject({
      kind: "INSECURE_CONTEXT",
    });
  });

  it("handles geolocation permission denied (code 1)", async () => {
    Object.defineProperty(window, "isSecureContext", {
      value: true,
      configurable: true,
    });

    const mockGeolocation = {
      getCurrentPosition: vi.fn((_success, error) => {
        error({
          code: 1, // PERMISSION_DENIED
          message: "User denied Geolocation",
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3,
        });
      }),
    };

    Object.defineProperty(navigator, "geolocation", {
      value: mockGeolocation,
      configurable: true,
    });

    await expect(getCurrentCoordinates()).rejects.toThrowError(GeolocationError);
    await expect(getCurrentCoordinates()).rejects.toMatchObject({
      kind: "PERMISSION_DENIED",
    });
  });

  it("handles geolocation timeout (code 3)", async () => {
    Object.defineProperty(window, "isSecureContext", {
      value: true,
      configurable: true,
    });

    const mockGeolocation = {
      getCurrentPosition: vi.fn((_success, error) => {
        error({
          code: 3, // TIMEOUT
          message: "Timeout expired",
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3,
        });
      }),
    };

    Object.defineProperty(navigator, "geolocation", {
      value: mockGeolocation,
      configurable: true,
    });

    await expect(getCurrentCoordinates()).rejects.toThrowError(GeolocationError);
    await expect(getCurrentCoordinates()).rejects.toMatchObject({
      kind: "TIMEOUT",
    });
  });

  it("successfully returns high-accuracy coordinates when permission granted", async () => {
    Object.defineProperty(window, "isSecureContext", {
      value: true,
      configurable: true,
    });

    const mockGeolocation = {
      getCurrentPosition: vi.fn((success) => {
        success({
          coords: {
            latitude: 37.7749,
            longitude: -122.4194,
            accuracy: 12.5,
          },
        });
      }),
    };

    Object.defineProperty(navigator, "geolocation", {
      value: mockGeolocation,
      configurable: true,
    });

    const pos = await getCurrentCoordinates();
    expect(pos.latitude).toBe(37.7749);
    expect(pos.longitude).toBe(-122.4194);
    expect(pos.accuracy).toBe(12.5);
  });

  it("reacquires fresh GPS coordinates on demand and fails safely if revoked", async () => {
    Object.defineProperty(window, "isSecureContext", {
      value: true,
      configurable: true,
    });

    let attempts = 0;
    const mockGeolocation = {
      getCurrentPosition: vi.fn((success, error) => {
        attempts++;
        if (attempts === 1) {
          success({
            coords: {
              latitude: 37.775,
              longitude: -122.418,
              accuracy: 10,
            },
          });
        } else {
          error({
            code: 2, // POSITION_UNAVAILABLE
            message: "GPS lost during transit",
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
          });
        }
      }),
    };

    Object.defineProperty(navigator, "geolocation", {
      value: mockGeolocation,
      configurable: true,
    });

    // Initial check passes
    const initialCoords = await getCurrentCoordinates();
    expect(initialCoords.latitude).toBe(37.775);

    // Immediate reacquisition before verification fails safely
    await expect(getCurrentCoordinates()).rejects.toThrowError(GeolocationError);
    await expect(getCurrentCoordinates()).rejects.toMatchObject({
      kind: "POSITION_UNAVAILABLE",
    });
  });
});

describe("Progression & Simulation Logic", () => {
  it("strictly enforces backend level formula: level = 1 + (xp // 500)", () => {
    expect(calculateLevel(0)).toBe(1);
    expect(calculateLevel(250)).toBe(1);
    expect(calculateLevel(499)).toBe(1);
    expect(calculateLevel(500)).toBe(2);
    expect(calculateLevel(999)).toBe(2);
    expect(calculateLevel(1000)).toBe(3);
    expect(calculateLevel(1500)).toBe(4);
  });

  it("correctly calculates XP tier progress", () => {
    const tier0 = getXpProgress(150);
    expect(tier0.currentTierXp).toBe(150);
    expect(tier0.progressPercent).toBe(30);
    expect(tier0.xpUntilNext).toBe(350);

    const tier1 = getXpProgress(750);
    expect(tier1.currentTierXp).toBe(250);
    expect(tier1.progressPercent).toBe(50);
    expect(tier1.xpUntilNext).toBe(250);
  });

  it("correctly identifies simulated demo quests", () => {
    const liveQuest: QuestResponse = {
      id: "uuid-1",
      title: "The Whispering Pines of Buena Vista",
      description: "A scenic grove hidden atop the ridge.",
      difficulty: "medium",
      estimated_minutes: 30,
      reward_xp: 200,
      status: "active",
      current_clues: [{ id: "c1", step_order: 1, clue: "Ascend the stairs", is_unlocked: true }],
      verification_prompt: "What year is engraved on the lookout stone?",
      destination_name: null,
      created_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      completed_at: null,
      updated_at: new Date().toISOString(),
    };
    expect(isSimulatedQuest(liveQuest)).toBe(false);

    const demoQuest: QuestResponse = {
      ...liveQuest,
      title: "[Simulated Demo] Central Library Courtyard",
      destination_name: "[Simulated Demo] Central Library Courtyard",
    };
    expect(isSimulatedQuest(demoQuest)).toBe(true);
  });
});
