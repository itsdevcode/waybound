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

/**
 * Reverse geocode coordinates to a human-readable location address.
 * Falls back cleanly when Google Geocoder is unconfigured or unavailable.
 */
export async function reverseGeocodeCoordinates(
  latitude: number,
  longitude: number
): Promise<string> {
  if (typeof window !== "undefined" && window.google?.maps?.Geocoder) {
    try {
      const geocoder = new window.google.maps.Geocoder();
      const response = await geocoder.geocode({
        location: { lat: latitude, lng: longitude },
      });
      if (response.results && response.results.length > 0) {
        return response.results[0].formatted_address;
      }
    } catch {
      // Fall through to fallback formatting
    }
  }

  // Fallback human-readable coordinate label
  const latStr = `${Math.abs(latitude).toFixed(4)}°${latitude >= 0 ? "N" : "S"}`;
  const lngStr = `${Math.abs(longitude).toFixed(4)}°${longitude >= 0 ? "E" : "W"}`;
  return `${latStr}, ${lngStr}`;
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
