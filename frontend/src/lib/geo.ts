export interface GeoCoordinates {
  latitude: number;
  longitude: number;
  accuracy: number;
}

export type GeoErrorKind =
  | "INSECURE_CONTEXT"
  | "NOT_SUPPORTED"
  | "PERMISSION_DENIED"
  | "POSITION_UNAVAILABLE"
  | "TIMEOUT"
  | "UNKNOWN";

export class GeolocationError extends Error {
  kind: GeoErrorKind;

  constructor(kind: GeoErrorKind, message: string) {
    super(message);
    this.name = "GeolocationError";
    this.kind = kind;
  }
}

/**
 * Requests native browser GPS coordinates with high accuracy.
 * Never fakes or guesses coordinates on failure.
 */
export async function getCurrentCoordinates(): Promise<GeoCoordinates> {
  if (typeof window === "undefined") {
    throw new GeolocationError(
      "NOT_SUPPORTED",
      "Geolocation is only available in the browser."
    );
  }

  // Security check: Geolocation requires HTTPS or localhost
  if (!window.isSecureContext) {
    throw new GeolocationError(
      "INSECURE_CONTEXT",
      "Geolocation requires a secure context (HTTPS or localhost). Please access WAYBOUND over HTTPS."
    );
  }

  if (!("geolocation" in navigator)) {
    throw new GeolocationError(
      "NOT_SUPPORTED",
      "Native geolocation is not supported by your current browser."
    );
  }

  return new Promise<GeoCoordinates>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
      },
      (error) => {
        switch (error.code) {
          case error.PERMISSION_DENIED:
            reject(
              new GeolocationError(
                "PERMISSION_DENIED",
                "Location permission was denied. Please grant location access in your browser settings to discover nearby quests."
              )
            );
            break;
          case error.POSITION_UNAVAILABLE:
            reject(
              new GeolocationError(
                "POSITION_UNAVAILABLE",
                "GPS signal unavailable. Ensure your device location/GPS is toggled on and has clear sky access."
              )
            );
            break;
          case error.TIMEOUT:
            reject(
              new GeolocationError(
                "TIMEOUT",
                "Location acquisition timed out. Please retry in an area with better GPS or cellular reception."
              )
            );
            break;
          default:
            reject(
              new GeolocationError(
                "UNKNOWN",
                error.message || "Failed to acquire location."
              )
            );
            break;
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    );
  });
}

export interface CityPreset {
  name: string;
  region: string;
  latitude: number;
  longitude: number;
}

export const POPULAR_CITIES: CityPreset[] = [
  { name: "San Francisco", region: "CA, USA", latitude: 37.7749, longitude: -122.4194 },
  { name: "New York", region: "NY, USA", latitude: 40.7128, longitude: -74.006 },
  { name: "London", region: "UK", latitude: 51.5074, longitude: -0.1278 },
  { name: "Tokyo", region: "Japan", latitude: 35.6762, longitude: 139.6503 },
  { name: "Paris", region: "France", latitude: 48.8566, longitude: 2.3522 },
  { name: "Seattle", region: "WA, USA", latitude: 47.6062, longitude: -122.3321 },
  { name: "Austin", region: "TX, USA", latitude: 30.2672, longitude: -97.7431 },
  { name: "Berlin", region: "Germany", latitude: 52.52, longitude: 13.405 },
];
