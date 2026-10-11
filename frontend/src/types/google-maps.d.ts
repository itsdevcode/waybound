/* eslint-disable @typescript-eslint/no-explicit-any */
// Ambient type definitions for Google Maps JavaScript API
declare namespace google {
  export namespace maps {
    export class Map {
      constructor(element: HTMLElement, options?: any);
      panTo(latLng: { lat: number; lng: number }): void;
      setZoom(zoom: number): void;
    }

    export class Marker {
      constructor(options: any);
      setMap(map: Map | null): void;
      setPosition(latLng: { lat: number; lng: number }): void;
      addListener(event: string, handler: () => void): void;
    }

    export class Circle {
      constructor(options: any);
      setMap(map: Map | null): void;
    }

    export class DirectionsRenderer {
      constructor(options?: any);
      setMap(map: Map | null): void;
      setDirections(result: any): void;
    }

    export interface DirectionsLeg {
      distance?: { text: string; value: number };
      duration?: { text: string; value: number };
    }

    export interface DirectionsRoute {
      legs: DirectionsLeg[];
    }

    export interface DirectionsResult {
      routes: DirectionsRoute[];
    }

    export class DirectionsService {
      constructor();
      route(
        request: any,
        callback: (result: DirectionsResult | null, status: DirectionsStatus) => void
      ): void;
    }

    export class Geocoder {
      constructor();
      geocode(request: any): Promise<{ results: Array<{ formatted_address: string }> }>;
    }

    export enum SymbolPath {
      BACKWARD_CLOSED_ARROW = 3,
      CIRCLE = 0,
      FORWARD_CLOSED_ARROW = 1,
      FORWARD_OPEN_ARROW = 2,
    }

    export enum TravelMode {
      WALKING = "WALKING",
      DRIVING = "DRIVING",
      BICYCLING = "BICYCLING",
      TRANSIT = "TRANSIT",
    }

    export enum DirectionsStatus {
      OK = "OK",
      NOT_FOUND = "NOT_FOUND",
      ZERO_RESULTS = "ZERO_RESULTS",
    }
  }
}

interface Window {
  google?: {
    maps?: typeof google.maps;
  };
  __wayboundGoogleMapsCallback?: () => void;
}
