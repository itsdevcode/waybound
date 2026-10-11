"use client";

import { useEffect, useState } from "react";

export type GoogleMapsStatus = "loading" | "ready" | "error" | "unconfigured";

let googleMapsScriptPromise: Promise<void> | null = null;

/**
 * Loads the Google Maps JavaScript API script dynamically.
 * Safely handles missing API keys, duplicates, and environment variables.
 */
export function loadGoogleMapsScript(apiKey?: string): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Window is not available during SSR"));
  }

  // Already loaded
  if (typeof window.google !== "undefined" && typeof window.google.maps !== "undefined") {
    return Promise.resolve();
  }

  const key = apiKey || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";
  if (!key.trim()) {
    return Promise.reject(new Error("GOOGLE_MAPS_API_KEY_UNCONFIGURED"));
  }

  if (googleMapsScriptPromise) {
    return googleMapsScriptPromise;
  }

  googleMapsScriptPromise = new Promise<void>((resolve, reject) => {
    // Check if script tag already exists
    const existingScript = document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]');
    if (existingScript) {
      existingScript.addEventListener("load", () => resolve());
      existingScript.addEventListener("error", (e) => reject(e));
      return;
    }

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      key.trim()
    )}&libraries=places,geometry&callback=__wayboundGoogleMapsCallback`;
    script.async = true;
    script.defer = true;

    // Attach global callback
    (window as unknown as { __wayboundGoogleMapsCallback?: () => void }).__wayboundGoogleMapsCallback = () => {
      resolve();
    };

    script.onerror = (err) => {
      googleMapsScriptPromise = null;
      reject(err);
    };

    document.head.appendChild(script);
  });

  return googleMapsScriptPromise;
}

/**
 * React Hook for loading and checking Google Maps Platform status.
 */
export function useGoogleMaps(apiKey?: string) {
  const [status, setStatus] = useState<GoogleMapsStatus>(() => {
    if (typeof window !== "undefined" && window.google?.maps) {
      return "ready";
    }
    const key = apiKey || (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY : "");
    if (!key || !key.trim()) {
      return "unconfigured";
    }
    return "loading";
  });

  useEffect(() => {
    if (status === "ready" || status === "unconfigured") return;

    const key = apiKey || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";
    if (!key.trim()) return;

    let isMounted = true;
    loadGoogleMapsScript(key)
      .then(() => {
        if (isMounted) setStatus("ready");
      })
      .catch((err) => {
        if (!isMounted) return;
        if (err?.message === "GOOGLE_MAPS_API_KEY_UNCONFIGURED") {
          setStatus("unconfigured");
        } else {
          setStatus("error");
        }
      });

    return () => {
      isMounted = false;
    };
  }, [apiKey, status]);

  return {
    status,
    isReady: status === "ready",
    isUnconfigured: status === "unconfigured",
  };
}

export interface ReverseGeocodeResult {
  formattedAddress: string;
  locality?: string;
  city?: string;
  district?: string;
  state?: string;
  country?: string;
  postalCode?: string;
}

export interface CitySuggestion {
  placeId: string;
  name: string;
  region: string;
  country: string;
  latitude?: number;
  longitude?: number;
}

/**
 * Reverse geocode coordinates to structured address fields.
 * Extracts formatted address, locality, city, district, state, country, and postal code.
 */
export async function reverseGeocodeDetails(
  latitude: number,
  longitude: number
): Promise<ReverseGeocodeResult> {
  const fallbackLabel = `${Math.abs(latitude).toFixed(4)}°${latitude >= 0 ? "N" : "S"}, ${Math.abs(
    longitude
  ).toFixed(4)}°${longitude >= 0 ? "E" : "W"}`;

  if (typeof window !== "undefined" && window.google?.maps?.Geocoder) {
    try {
      const geocoder = new window.google.maps.Geocoder();
      const response = await geocoder.geocode({
        location: { lat: latitude, lng: longitude },
      });

      if (response.results && response.results.length > 0) {
        const topResult = response.results[0];
        let locality: string | undefined;
        let city: string | undefined;
        let district: string | undefined;
        let state: string | undefined;
        let country: string | undefined;
        let postalCode: string | undefined;

        for (const comp of topResult.address_components || []) {
          const types = comp.types || [];
          if (types.includes("locality")) {
            locality = comp.long_name;
            city = comp.long_name;
          } else if (!city && types.includes("administrative_area_level_2")) {
            district = comp.long_name;
            city = comp.long_name;
          } else if (types.includes("administrative_area_level_2")) {
            district = comp.long_name;
          } else if (types.includes("administrative_area_level_1")) {
            state = comp.long_name;
          } else if (types.includes("country")) {
            country = comp.long_name;
          } else if (types.includes("postal_code")) {
            postalCode = comp.long_name;
          }
        }

        return {
          formattedAddress: topResult.formatted_address || fallbackLabel,
          locality,
          city,
          district,
          state,
          country,
          postalCode,
        };
      }
    } catch {
      // Fall through to fallback result
    }
  }

  return {
    formattedAddress: fallbackLabel,
  };
}

/**
 * Reverse geocode coordinates to a human-readable location address.
 * Falls back cleanly when Google Geocoder is unconfigured or unavailable.
 */
export async function reverseGeocodeCoordinates(
  latitude: number,
  longitude: number
): Promise<string> {
  const details = await reverseGeocodeDetails(latitude, longitude);
  return details.formattedAddress;
}

/**
 * Searches city autocomplete suggestions using Google Places AutocompleteService.
 */
export async function searchCityAutocomplete(
  input: string,
  countryCode?: string
): Promise<CitySuggestion[]> {
  const query = input.trim();
  if (!query || query.length < 2) return [];

  if (
    typeof window !== "undefined" &&
    window.google?.maps?.places?.AutocompleteService
  ) {
    return new Promise((resolve) => {
      try {
        const service = new window.google.maps.places.AutocompleteService();
        const request: {
          input: string;
          types: string[];
          componentRestrictions?: { country: string };
        } = {
          input: query,
          types: ["(cities)"],
        };
        if (countryCode) {
          request.componentRestrictions = { country: countryCode };
        }

        service.getPlacePredictions(request, (predictions, status) => {
          if (status !== "OK" || !predictions) {
            resolve([]);
            return;
          }

          const results: CitySuggestion[] = predictions.map((p) => {
            const mainText = p.structured_formatting?.main_text || p.description.split(",")[0];
            const secondaryText = p.structured_formatting?.secondary_text || "";
            const parts = secondaryText.split(",").map((s) => s.trim()).filter(Boolean);
            const country = parts.length > 0 ? parts[parts.length - 1] : "";
            const region = parts.length > 1 ? parts.slice(0, parts.length - 1).join(", ") : parts[0] || "";

            return {
              placeId: p.place_id,
              name: mainText,
              region: region || secondaryText,
              country: country,
            };
          });

          resolve(results);
        });
      } catch {
        resolve([]);
      }
    });
  }

  return [];
}

/**
 * Retrieves coordinates and formatted details for a place_id using Google PlacesService or Geocoder.
 */
export async function getCityDetailsFromPlaceId(
  placeId: string
): Promise<{
  name: string;
  region: string;
  latitude: number;
  longitude: number;
  formattedAddress: string;
} | null> {
  if (typeof window === "undefined" || !window.google?.maps) return null;

  // Try Geocoder first by placeId
  if (window.google.maps.Geocoder) {
    try {
      const geocoder = new window.google.maps.Geocoder();
      const response = await geocoder.geocode({ placeId });
      if (response.results && response.results.length > 0) {
        const res = response.results[0];
        const lat = res.geometry?.location.lat();
        const lng = res.geometry?.location.lng();
        if (lat !== undefined && lng !== undefined && typeof lat === "number" && typeof lng === "number") {
          let name = res.formatted_address.split(",")[0];
          let region = "";
          for (const comp of res.address_components || []) {
            if (comp.types.includes("locality")) {
              name = comp.long_name;
            } else if (comp.types.includes("administrative_area_level_1")) {
              region = comp.short_name || comp.long_name;
            }
          }
          return {
            name,
            region,
            latitude: lat,
            longitude: lng,
            formattedAddress: res.formatted_address,
          };
        }
      }
    } catch {
      // Fall through to PlacesService
    }
  }

  // Fallback to PlacesService
  if (window.google.maps.places?.PlacesService) {
    return new Promise((resolve) => {
      try {
        const div = document.createElement("div");
        const service = new window.google.maps.places.PlacesService(div);
        service.getDetails(
          {
            placeId,
            fields: ["name", "geometry", "formatted_address", "address_components"],
          },
          (result, status) => {
            if (status === "OK" && result?.geometry?.location) {
              const lat = result.geometry.location.lat();
              const lng = result.geometry.location.lng();
              let region = "";
              for (const comp of result.address_components || []) {
                if (comp.types.includes("administrative_area_level_1")) {
                  region = comp.short_name || comp.long_name;
                }
              }
              resolve({
                name: result.name || result.formatted_address?.split(",")[0] || "Selected City",
                region,
                latitude: lat,
                longitude: lng,
                formattedAddress: result.formatted_address || `${lat}, ${lng}`,
              });
            } else {
              resolve(null);
            }
          }
        );
      } catch {
        resolve(null);
      }
    });
  }

  return null;
}

/**
 * Walking ETA calculator:
 * Standard walking speed: ~4.8 km/h (~80 meters/minute).
 */
export function estimateWalkingMinutes(distanceMeters: number): number {
  if (distanceMeters <= 0) return 1;
  const minutes = Math.round(distanceMeters / 80);
  return Math.max(1, minutes);
}

/**
 * Generates an official external Google Maps walking navigation URL.
 */
export function getGoogleMapsNavigationUrl(
  destinationLat: number,
  destinationLng: number,
  originLat?: number,
  originLng?: number
): string {
  const dest = `${destinationLat},${destinationLng}`;
  if (originLat !== undefined && originLng !== undefined) {
    const origin = `${originLat},${originLng}`;
    return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(
      origin
    )}&destination=${encodeURIComponent(dest)}&travelmode=walking`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(dest)}`;
}
