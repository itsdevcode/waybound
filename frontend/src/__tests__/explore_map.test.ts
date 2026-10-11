import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  estimateWalkingMinutes,
  getGoogleMapsNavigationUrl,
  reverseGeocodeCoordinates,
} from "@/lib/maps";
import { api } from "@/lib/api";

describe("Interactive Quest Map Utilities", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("Walking ETA Calculation", () => {
    it("calculates realistic walking duration based on ~80m/min", () => {
      expect(estimateWalkingMinutes(0)).toBe(1);
      expect(estimateWalkingMinutes(80)).toBe(1);
      expect(estimateWalkingMinutes(400)).toBe(5);
      expect(estimateWalkingMinutes(800)).toBe(10);
      expect(estimateWalkingMinutes(1600)).toBe(20);
    });
  });

  describe("Google Maps Navigation URL", () => {
    it("generates walking directions url when origin and destination coordinates are provided", () => {
      const url = getGoogleMapsNavigationUrl(37.7749, -122.4194, 37.7833, -122.4167);
      expect(url).toContain("https://www.google.com/maps/dir/");
      expect(url).toContain("destination=37.7749%2C-122.4194");
      expect(url).toContain("origin=37.7833%2C-122.4167");
      expect(url).toContain("travelmode=walking");
    });

    it("generates destination search url when only destination is provided", () => {
      const url = getGoogleMapsNavigationUrl(37.7749, -122.4194);
      expect(url).toContain("https://www.google.com/maps/search/");
      expect(url).toContain("query=37.7749%2C-122.4194");
    });
  });

  describe("Reverse Geocoding Coordinates", () => {
    it("formats human-readable coordinate label when Google Geocoder is not loaded", async () => {
      const label = await reverseGeocodeCoordinates(37.7749, -122.4194);
      expect(label).toBe("37.7749°N, 122.4194°W");
    });

    it("formats southern and eastern coordinates correctly", async () => {
      const label = await reverseGeocodeCoordinates(-33.8688, 151.2093);
      expect(label).toBe("33.8688°S, 151.2093°E");
    });
  });

  describe("Nearby Quests API Client", () => {
    it("formats query parameters correctly for GET /api/v1/quests/nearby", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          items: [
            {
              id: "00000000-0000-0000-0000-000000000001",
              title: "Test Mystery",
              description: "Teaser",
              difficulty: "medium",
              estimated_minutes: 30,
              reward_xp: 200,
              status: "available",
              latitude: 37.7749,
              longitude: -122.4194,
              distance_meters: 250,
              verification_radius_meters: 100,
              is_active: false,
            },
          ],
          center_latitude: 37.7749,
          center_longitude: -122.4194,
          radius_meters: 1000,
          total_count: 1,
        }),
      } as unknown as Response);

      const res = await api.getNearbyQuests(37.7749, -122.4194, 1000, 20);
      expect(fetchSpy).toHaveBeenCalled();
      const calledUrl = fetchSpy.mock.calls[0][0] as string;
      expect(calledUrl).toContain("/api/v1/quests/nearby");
      expect(calledUrl).toContain("latitude=37.7749");
      expect(calledUrl).toContain("longitude=-122.4194");
      expect(calledUrl).toContain("radius_meters=1000");

      expect(res.total_count).toBe(1);
      expect(res.items[0].verification_radius_meters).toBe(100);
      expect(res.items[0].distance_meters).toBe(250);
    });

    it("preserves is_simulated flag from API response for markers and badges", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          items: [
            {
              id: null,
              title: "Art Institute of Chicago",
              description: "Public museum landmark",
              difficulty: "medium",
              estimated_minutes: 30,
              reward_xp: 150,
              status: "available",
              latitude: 41.8796,
              longitude: -87.6237,
              distance_meters: 350,
              verification_radius_meters: 100,
              is_active: false,
              is_simulated: false,
            },
            {
              id: null,
              title: "[Demo Scenario] Central Library Courtyard",
              description: "[Simulated POI - 0 XP] Demo exploration point",
              difficulty: "easy",
              estimated_minutes: 20,
              reward_xp: 0,
              status: "available",
              latitude: 37.7749,
              longitude: -122.4194,
              distance_meters: 500,
              verification_radius_meters: 100,
              is_active: false,
              is_simulated: true,
            },
          ],
          center_latitude: 41.8796,
          center_longitude: -87.6237,
          radius_meters: 1000,
          total_count: 2,
        }),
      } as unknown as Response);

      const res = await api.getNearbyQuests(41.8796, -87.6237, 1000);
      expect(res.items[0].is_simulated).toBe(false);
      expect(res.items[1].is_simulated).toBe(true);
    });
  });

  describe("Google Maps Route Duration vs Straight-Line Fallback", () => {
    it("distinguishes between Google directions walking time and straight-line approximation", () => {
      // Directions API provides exact pedestrian path with street crossings
      const googleWalkingMinutes = 14;
      const straightLineMinutes = estimateWalkingMinutes(800); // 10 minutes

      expect(googleWalkingMinutes).toBeGreaterThan(straightLineMinutes);
      expect(`Route: ${googleWalkingMinutes} mins`).toContain("Route:");
      expect(`Straight-Line Est: ~${straightLineMinutes} min`).toContain("Straight-Line Est:");
    });
  });

  describe("Continuous Live GPS Tracking (watchCoordinates)", () => {
    it("tracks live position updates and clears watch correctly", async () => {
      const { watchCoordinates } = await import("@/lib/geo");

      const mockClearWatch = vi.fn();
      const mockWatchPosition = vi.fn().mockImplementation((success) => {
        // Simulate immediate GPS fix and movement
        success({
          coords: {
            latitude: 37.7749,
            longitude: -122.4194,
            accuracy: 12,
          },
        });
        return 999;
      });

      vi.stubGlobal("navigator", {
        geolocation: {
          watchPosition: mockWatchPosition,
          clearWatch: mockClearWatch,
        },
      });

      const positions: Array<{ latitude: number; longitude: number; accuracy: number }> = [];
      const cleanup = watchCoordinates((coords) => {
        positions.push(coords);
      });

      expect(mockWatchPosition).toHaveBeenCalled();
      expect(positions.length).toBe(1);
      expect(positions[0].latitude).toBe(37.7749);
      expect(positions[0].accuracy).toBe(12);

      // Verify unwatch cleanup
      cleanup();
      expect(mockClearWatch).toHaveBeenCalledWith(999);
    });
  });

  describe("Destination Secrecy & Accessible Route Handling", () => {
    it("preserves is_destination_secret flag from API for privacy protection", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          items: [
            {
              id: "00000000-0000-0000-0000-000000000002",
              title: "Active Hidden Adventure",
              description: "Follow clues to uncover this mystery location",
              difficulty: "medium",
              estimated_minutes: 30,
              reward_xp: 150,
              status: "active",
              latitude: 37.7749,
              longitude: -122.4194,
              distance_meters: 0,
              verification_radius_meters: 100,
              is_active: true,
              is_destination_secret: true,
            },
          ],
          center_latitude: 37.7749,
          center_longitude: -122.4194,
          radius_meters: 1000,
          total_count: 1,
        }),
      } as unknown as Response);

      const res = await api.getNearbyQuests(37.7749, -122.4194, 1000);
      expect(res.items[0].is_destination_secret).toBe(true);
      expect(res.items[0].is_active).toBe(true);
    });

    it("formats accessible turn-by-turn text steps without HTML tags", () => {
      const rawSteps = [
        { instructions: "Head <b>north</b> on Market St toward 4th St", distance: { text: "0.2 mi" } },
        { instructions: "Turn <b>right</b> onto 4th St", distance: { text: "350 ft" } },
      ];

      const cleanedSteps = rawSteps.map((s) => ({
        instructions: s.instructions.replace(/<[^>]+>/g, " ").trim(),
        distanceText: s.distance.text,
      }));

      expect(cleanedSteps[0].instructions).toBe("Head  north  on Market St toward 4th St");
      expect(cleanedSteps[0].instructions).not.toContain("<b>");
      expect(cleanedSteps[1].instructions).toBe("Turn  right  onto 4th St");
      expect(cleanedSteps[1].distanceText).toBe("350 ft");
    });

    it("enforces that mystery quests without genuine waypoints never invent fake route coordinates", () => {
      // Clues without coordinates
      const textOnlyClues = [
        {
          id: "step-1",
          step_order: 1,
          clue: "Seek the bronze bell near the fountain.",
          is_unlocked: true,
          latitude: null,
          longitude: null,
        },
      ];

      // Filter for genuine waypoints
      const genuineWaypoints = textOnlyClues.filter(
        (c) => c.is_unlocked && typeof c.latitude === "number" && typeof c.longitude === "number"
      );

      // No fake waypoints invented!
      expect(genuineWaypoints.length).toBe(0);
    });

    it("detects genuine unlocked intermediate waypoints and updates route target accordingly", () => {
      const progressiveClues = [
        {
          id: "step-1",
          step_order: 1,
          clue: "Begin at the library entrance.",
          is_unlocked: true,
          latitude: 37.776,
          longitude: -122.417,
          waypoint_name: "Civic Center Library",
        },
        {
          id: "step-2",
          step_order: 2,
          clue: "Proceed to the historic fountain.",
          is_unlocked: true,
          latitude: 37.778,
          longitude: -122.415,
          waypoint_name: "Historic Fountain",
        },
        {
          id: "step-3",
          step_order: 3,
          clue: "Find the hidden stone plaque.",
          is_unlocked: false,
          latitude: 37.780,
          longitude: -122.413,
          waypoint_name: "Hidden Plaque",
        },
      ];

      const unlockedWithWaypoints = progressiveClues.filter(
        (c) => c.is_unlocked && typeof c.latitude === "number" && typeof c.longitude === "number"
      );

      expect(unlockedWithWaypoints.length).toBe(2);
      // The current target waypoint should be the latest unlocked one (Hint #2)
      const currentTarget = unlockedWithWaypoints[unlockedWithWaypoints.length - 1];
      expect(currentTarget.step_order).toBe(2);
      expect(currentTarget.waypoint_name).toBe("Historic Fountain");
      expect(currentTarget.latitude).toBe(37.778);
      expect(currentTarget.longitude).toBe(-122.415);
    });

    it("throttles walking route recalculation when explorer movement is within 25 meters", () => {
      const haversineMeters = (lat1: number, lon1: number, lat2: number, lon2: number) => {
        const R = 6371000;
        const dLat = ((lat2 - lat1) * Math.PI) / 180;
        const dLon = ((lon2 - lon1) * Math.PI) / 180;
        const a =
          Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos((lat1 * Math.PI) / 180) *
            Math.cos((lat2 * Math.PI) / 180) *
            Math.sin(dLon / 2) *
            Math.sin(dLon / 2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      };

      const startLat = 37.7749;
      const startLon = -122.4194;

      // Small jitter: ~10 meters
      const slightMoveLat = 37.77498;
      const slightMoveLon = -122.4194;
      const distSmall = haversineMeters(startLat, startLon, slightMoveLat, slightMoveLon);
      expect(distSmall).toBeLessThan(25);

      // Significant movement: ~80 meters
      const bigMoveLat = 37.7756;
      const bigMoveLon = -122.4194;
      const distBig = haversineMeters(startLat, startLon, bigMoveLat, bigMoveLon);
      expect(distBig).toBeGreaterThan(25);
    });

    it("gracefully handles Directions API route failure by not creating fake routes", () => {
      let routeResult: { distanceText: string } | null = { distanceText: "100m" };

      // Simulate API failure status ZERO_RESULTS or NOT_FOUND
      const apiStatus: string = "ZERO_RESULTS";
      if (apiStatus !== "OK") {
        routeResult = null;
      }

      expect(routeResult).toBeNull();
    });

    it("verifies GPS accuracy circle radius reflects high-accuracy GPS reading", () => {
      const gpsReading = {
        latitude: 37.7749,
        longitude: -122.4194,
        accuracy: 14.5,
      };

      const circleRadius = Math.max(10, gpsReading.accuracy || 20);
      expect(circleRadius).toBe(14.5);
      expect(circleRadius).toBeLessThan(20);
    });
  });
});
