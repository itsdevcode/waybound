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
  });
});
