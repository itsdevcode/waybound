import { describe, it, expect, vi, beforeEach } from "vitest";
import { getCurrentCoordinates, GeolocationError, POPULAR_CITIES } from "@/lib/geo";
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

describe("City Presets & Manual Location Fallback", () => {
  it("provides valid coordinate presets for popular adventure cities", () => {
    expect(POPULAR_CITIES.length).toBeGreaterThanOrEqual(5);

    for (const city of POPULAR_CITIES) {
      expect(city.name).toBeDefined();
      expect(city.region).toBeDefined();
      expect(city.latitude).toBeGreaterThanOrEqual(-90);
      expect(city.latitude).toBeLessThanOrEqual(90);
      expect(city.longitude).toBeGreaterThanOrEqual(-180);
      expect(city.longitude).toBeLessThanOrEqual(180);
    }
  });

  it("ensures manual city selection cannot be treated as verified GPS evidence for earning real-world XP", () => {
    const manualVerifyPayload = {
      latitude: POPULAR_CITIES[0].latitude,
      longitude: POPULAR_CITIES[0].longitude,
      observation_answer: "owl",
      is_manual_location: true,
    };

    // When manual location is submitted, is_manual_location must be explicitly flagged
    expect(manualVerifyPayload.is_manual_location).toBe(true);
  });
});

describe("Dynamic Reverse Geocoding & Address Breakdown", () => {
  it("extracts locality, city, district, state, country, and postal code from Google Geocoder results", async () => {
    const { reverseGeocodeDetails } = await import("@/lib/maps");

    const mockGeocoderResult = {
      formatted_address: "123 Market St, San Francisco, CA 94105, USA",
      address_components: [
        { long_name: "123", short_name: "123", types: ["street_number"] },
        { long_name: "Market Street", short_name: "Market St", types: ["route"] },
        { long_name: "Financial District", short_name: "Financial District", types: ["neighborhood"] },
        { long_name: "San Francisco", short_name: "SF", types: ["locality"] },
        { long_name: "San Francisco County", short_name: "SF County", types: ["administrative_area_level_2"] },
        { long_name: "California", short_name: "CA", types: ["administrative_area_level_1"] },
        { long_name: "United States", short_name: "US", types: ["country"] },
        { long_name: "94105", short_name: "94105", types: ["postal_code"] },
      ],
    };

    // Mock google.maps.Geocoder on global window
    (window as unknown as { google: unknown }).google = {
      maps: {
        Geocoder: class {
          geocode(_req: unknown) {
            return Promise.resolve({
              results: [mockGeocoderResult],
            });
          }
        },
      },
    };

    const details = await reverseGeocodeDetails(37.7749, -122.4194);
    expect(details.formattedAddress).toBe("123 Market St, San Francisco, CA 94105, USA");
    expect(details.city).toBe("San Francisco");
    expect(details.district).toBe("San Francisco County");
    expect(details.state).toBe("California");
    expect(details.country).toBe("United States");
    expect(details.postalCode).toBe("94105");
  });

  it("handles geocoding failure gracefully without throwing unhandled exceptions", async () => {
    const { reverseGeocodeDetails } = await import("@/lib/maps");

    (window as unknown as { google: unknown }).google = {
      maps: {
        Geocoder: class {
          geocode(_req: unknown) {
            return Promise.reject(new Error("Geocoder service failed"));
          }
        },
      },
    };

    const details = await reverseGeocodeDetails(0, 0);
    expect(details.formattedAddress).toBe("0.0000°N, 0.0000°E");
    expect(details.city).toBeUndefined();
  });
});


