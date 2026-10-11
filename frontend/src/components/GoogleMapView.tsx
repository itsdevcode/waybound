"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import type { NearbyQuestItem, QuestStepResponse } from "@/types/api";
import { getGoogleMapsNavigationUrl } from "@/lib/maps";
import {
  Crosshair,
  Plus,
  Minus,
  HelpCircle,
  Navigation,
  ExternalLink,
  X,
  Compass,
  Footprints,
  Shield,
  Sparkles,
} from "lucide-react";

export interface CalculatedRouteInfo {
  distanceText: string;
  durationText: string;
  durationMinutes: number;
  isMystery?: boolean;
  targetType?: "destination" | "waypoint" | "zone";
  targetName?: string;
  steps?: Array<{ instructions: string; distanceText: string }>;
}

interface GoogleMapViewProps {
  center: { latitude: number; longitude: number };
  userLocation: { latitude: number; longitude: number; accuracy: number; isManual?: boolean } | null;
  radiusMeters: number;
  quests: NearbyQuestItem[];
  selectedQuest: NearbyQuestItem | null;
  onSelectQuest: (quest: NearbyQuestItem) => void;
  activeQuestGeofenceMeters?: number;
  onRouteCalculated?: (routeInfo: CalculatedRouteInfo | null) => void;
  activeQuestClues?: QuestStepResponse[];
  onRecenterUser?: () => void;
  onShowHint?: () => void;
}

// Distance helper for throttling route recalculations
function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function GoogleMapView({
  center,
  userLocation,
  radiusMeters,
  quests,
  selectedQuest,
  onSelectQuest,
  activeQuestGeofenceMeters = 100,
  onRouteCalculated,
  activeQuestClues = [],
  onRecenterUser,
  onShowHint,
}: GoogleMapViewProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const userMarkerRef = useRef<google.maps.Marker | null>(null);
  const accuracyCircleRef = useRef<google.maps.Circle | null>(null);
  const radiusCircleRef = useRef<google.maps.Circle | null>(null);
  const mysteryZoneCircleRef = useRef<google.maps.Circle | null>(null);
  const geofenceCircleRef = useRef<google.maps.Circle | null>(null);
  const questMarkersRef = useRef<google.maps.Marker[]>([]);
  const hintMarkersRef = useRef<google.maps.Marker[]>([]);
  const directionsRendererRef = useRef<google.maps.DirectionsRenderer | null>(null);

  // Throttling references
  const lastRouteOriginRef = useRef<{ lat: number; lng: number } | null>(null);
  const lastRouteDestRef = useRef<{ lat: number; lng: number } | null>(null);
  const lastRouteTimeRef = useRef<number>(0);

  // Selected hint popover state
  const [activeClueCard, setActiveClueCard] = useState<QuestStepResponse | null>(null);
  const [isFollowingRoute, setIsFollowingRoute] = useState<boolean>(false);
  const [currentRouteInfo, setCurrentRouteInfo] = useState<CalculatedRouteInfo | null>(null);

  // Initialize Map with dark purple theme
  useEffect(() => {
    if (!mapContainerRef.current || typeof window === "undefined" || !window.google?.maps) return;

    if (!mapInstanceRef.current) {
      mapInstanceRef.current = new window.google.maps.Map(mapContainerRef.current, {
        center: { lat: center.latitude, lng: center.longitude },
        zoom: radiusMeters <= 1000 ? 15 : radiusMeters <= 2000 ? 14 : 13,
        mapId: "DEMO_MAP_ID",
        disableDefaultUI: false,
        zoomControl: false, // Replaced by custom styled WAYBOUND controls
        streetViewControl: false,
        fullscreenControl: false,
        mapTypeControl: false,
        styles: [
          { elementType: "geometry", stylers: [{ color: "#17142b" }] },
          { elementType: "labels.text.stroke", stylers: [{ color: "#1b1834" }] },
          { elementType: "labels.text.fill", stylers: [{ color: "#a5a1d1" }] },
          {
            featureType: "administrative.locality",
            elementType: "labels.text.fill",
            stylers: [{ color: "#d5a6bd" }],
          },
          {
            featureType: "poi",
            elementType: "labels.text.fill",
            stylers: [{ color: "#a5a1d1" }],
          },
          {
            featureType: "poi.park",
            elementType: "geometry",
            stylers: [{ color: "#192823" }],
          },
          {
            featureType: "road",
            elementType: "geometry",
            stylers: [{ color: "#282348" }],
          },
          {
            featureType: "road",
            elementType: "geometry.stroke",
            stylers: [{ color: "#1c1836" }],
          },
          {
            featureType: "road.highway",
            elementType: "geometry",
            stylers: [{ color: "#3c336b" }],
          },
          {
            featureType: "water",
            elementType: "geometry",
            stylers: [{ color: "#0d0b1a" }],
          },
        ],
      });
    }
  }, [center.latitude, center.longitude, radiusMeters]);

  // Update Center and Zoom on center / radius change (unless user is following route)
  useEffect(() => {
    if (!mapInstanceRef.current || !window.google?.maps || isFollowingRoute) return;
    mapInstanceRef.current.panTo({ lat: center.latitude, lng: center.longitude });
    const zoomLevel = radiusMeters <= 500 ? 16 : radiusMeters <= 1000 ? 15 : radiusMeters <= 2000 ? 14 : 13;
    mapInstanceRef.current.setZoom(zoomLevel);
  }, [center.latitude, center.longitude, radiusMeters, isFollowingRoute]);

  // Update Exploration Radius Circle
  useEffect(() => {
    if (!mapInstanceRef.current || !window.google?.maps) return;

    if (radiusCircleRef.current) {
      radiusCircleRef.current.setMap(null);
    }

    radiusCircleRef.current = new window.google.maps.Circle({
      map: mapInstanceRef.current,
      center: { lat: center.latitude, lng: center.longitude },
      radius: radiusMeters,
      fillColor: "#8b5cf6",
      fillOpacity: 0.1,
      strokeColor: "#a78bfa",
      strokeOpacity: 0.5,
      strokeWeight: 1.5,
    });

    return () => {
      if (radiusCircleRef.current) {
        radiusCircleRef.current.setMap(null);
      }
    };
  }, [center.latitude, center.longitude, radiusMeters]);

  // Update User Location Marker & GPS Accuracy Circle
  useEffect(() => {
    if (!mapInstanceRef.current || !window.google?.maps || !userLocation) {
      if (userMarkerRef.current) {
        userMarkerRef.current.setMap(null);
        userMarkerRef.current = null;
      }
      if (accuracyCircleRef.current) {
        accuracyCircleRef.current.setMap(null);
        accuracyCircleRef.current = null;
      }
      return;
    }

    const position = { lat: userLocation.latitude, lng: userLocation.longitude };

    // 1. User Position Marker
    if (!userMarkerRef.current) {
      userMarkerRef.current = new window.google.maps.Marker({
        position,
        map: mapInstanceRef.current,
        title: "Your Live Explorer Location",
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: 9,
          fillColor: "#38bdf8",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 3,
        },
        zIndex: 100,
      });
    } else {
      userMarkerRef.current.setPosition(position);
    }

    // 2. User GPS Accuracy Circle
    const accuracy = Math.max(10, userLocation.accuracy || 20);
    if (!accuracyCircleRef.current) {
      accuracyCircleRef.current = new window.google.maps.Circle({
        map: mapInstanceRef.current,
        center: position,
        radius: accuracy,
        fillColor: "#38bdf8",
        fillOpacity: 0.12,
        strokeColor: "#38bdf8",
        strokeOpacity: 0.45,
        strokeWeight: 1.5,
      });
    } else {
      accuracyCircleRef.current.setCenter(position);
      accuracyCircleRef.current.setRadius(accuracy);
    }

    // If following route, smoothly pan to explorer position
    if (isFollowingRoute && mapInstanceRef.current) {
      mapInstanceRef.current.panTo(position);
    }
  }, [userLocation, isFollowingRoute]);

  // Update Purple Translucent Mystery Search Zone
  // strictly approximate and never exposes hidden destination coordinates
  useEffect(() => {
    if (!mapInstanceRef.current || !window.google?.maps) return;

    if (mysteryZoneCircleRef.current) {
      mysteryZoneCircleRef.current.setMap(null);
      mysteryZoneCircleRef.current = null;
    }

    const activeOrSelected = quests.find((q) => q.status === "active") || selectedQuest;
    if (activeOrSelected && activeOrSelected.is_destination_secret && activeOrSelected.status !== "completed") {
      // The search zone centers on the quest anchor (user/exploration start area, never secret destination)
      const zoneRadius = Math.max(150, Math.min(activeOrSelected.verification_radius_meters * 2.5, 400));
      mysteryZoneCircleRef.current = new window.google.maps.Circle({
        map: mapInstanceRef.current,
        center: { lat: activeOrSelected.latitude, lng: activeOrSelected.longitude },
        radius: zoneRadius,
        fillColor: "#8b5cf6",
        fillOpacity: 0.16,
        strokeColor: "#a855f7",
        strokeOpacity: 0.8,
        strokeWeight: 2,
      });
    }

    return () => {
      if (mysteryZoneCircleRef.current) {
        mysteryZoneCircleRef.current.setMap(null);
      }
    };
  }, [quests, selectedQuest]);

  // Update Quest Markers (Public Landmarks / Revealed Quests only)
  useEffect(() => {
    if (!mapInstanceRef.current || !window.google?.maps) return;

    // Clear existing quest markers
    questMarkersRef.current.forEach((m) => m.setMap(null));
    questMarkersRef.current = [];

    quests.forEach((quest) => {
      // CRITICAL PRIVACY: Never plot a secret destination marker before reveal!
      if (quest.is_destination_secret && quest.status !== "completed") {
        return;
      }

      const isSelected = selectedQuest?.title === quest.title;
      let fillColor = "#9333ea"; // Purple for available
      let strokeColor = "#fbbf24"; // Gold trim
      if (quest.status === "active") {
        fillColor = "#f59e0b"; // Glowing Amber/Gold for active quest
        strokeColor = "#ffffff";
      } else if (quest.status === "completed") {
        fillColor = "#10b981"; // Emerald for completed
        strokeColor = "#6ee7b7";
      } else if (quest.status === "locked") {
        fillColor = "#475569"; // Slate for locked
        strokeColor = "#94a3b8";
      }

      if (isSelected) {
        strokeColor = "#ffffff";
      }

      const marker = new window.google.maps.Marker({
        position: { lat: quest.latitude, lng: quest.longitude },
        map: mapInstanceRef.current,
        title: quest.title,
        icon: {
          path: window.google.maps.SymbolPath.BACKWARD_CLOSED_ARROW,
          scale: isSelected ? 8 : 6,
          fillColor,
          fillOpacity: 0.95,
          strokeColor,
          strokeWeight: isSelected ? 3 : 2,
        },
        zIndex: quest.status === "active" ? 95 : isSelected ? 90 : 50,
      });

      marker.addListener("click", () => {
        onSelectQuest(quest);
      });

      questMarkersRef.current.push(marker);
    });

    return () => {
      questMarkersRef.current.forEach((m) => m.setMap(null));
      questMarkersRef.current = [];
    };
  }, [quests, selectedQuest, onSelectQuest]);

  // Update Interactive Question-Mark Hint Markers (?) at Genuine Unlocked Waypoints
  useEffect(() => {
    if (!mapInstanceRef.current || !window.google?.maps) return;

    // Clear existing hint markers
    hintMarkersRef.current.forEach((m) => m.setMap(null));
    hintMarkersRef.current = [];

    const unlockedWaypoints = activeQuestClues.filter(
      (c) => c.is_unlocked && typeof c.latitude === "number" && typeof c.longitude === "number"
    );

    unlockedWaypoints.forEach((clue) => {
      if (typeof clue.latitude !== "number" || typeof clue.longitude !== "number") return;

      // Question mark SVG icon
      const svgIcon = {
        url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
          <svg xmlns="http://www.w3.org/2000/svg" width="38" height="46" viewBox="0 0 38 46">
            <defs>
              <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000" flood-opacity="0.6"/>
              </filter>
            </defs>
            <path d="M19 0 C8.5 0 0 8.5 0 19 C0 31 19 46 19 46 C19 46 38 31 38 19 C38 8.5 29.5 0 19 0 Z" fill="#9333ea" stroke="#fbbf24" stroke-width="2.5" filter="url(#shadow)"/>
            <circle cx="19" cy="18" r="13" fill="#1e1035"/>
            <text x="19" y="24" font-family="sans-serif" font-size="16" font-weight="900" fill="#fbbf24" text-anchor="middle">?</text>
          </svg>
        `)}`,
        scaledSize: new window.google.maps.Size(38, 46),
        anchor: new window.google.maps.Point(19, 46),
      };

      const marker = new window.google.maps.Marker({
        position: { lat: clue.latitude, lng: clue.longitude },
        map: mapInstanceRef.current,
        title: `Hint #${clue.step_order}: ${clue.waypoint_name || "Clue Waypoint"}`,
        icon: svgIcon,
        zIndex: 98,
      });

      marker.addListener("click", () => {
        setActiveClueCard(clue);
      });

      hintMarkersRef.current.push(marker);
    });

    return () => {
      hintMarkersRef.current.forEach((m) => m.setMap(null));
      hintMarkersRef.current = [];
    };
  }, [activeQuestClues]);

  // Geofence Circle for Revealed / Completed Quest
  useEffect(() => {
    if (!mapInstanceRef.current || !window.google?.maps) return;

    if (geofenceCircleRef.current) {
      geofenceCircleRef.current.setMap(null);
      geofenceCircleRef.current = null;
    }

    const activeOrSelected = quests.find((q) => q.status === "active") || selectedQuest;
    if (activeOrSelected && (!activeOrSelected.is_destination_secret || activeOrSelected.status === "completed")) {
      geofenceCircleRef.current = new window.google.maps.Circle({
        map: mapInstanceRef.current,
        center: { lat: activeOrSelected.latitude, lng: activeOrSelected.longitude },
        radius: activeQuestGeofenceMeters,
        fillColor: "#10b981",
        fillOpacity: 0.18,
        strokeColor: "#34d399",
        strokeOpacity: 0.9,
        strokeWeight: 2,
      });
    }

    return () => {
      if (geofenceCircleRef.current) {
        geofenceCircleRef.current.setMap(null);
      }
    };
  }, [quests, selectedQuest, activeQuestGeofenceMeters]);

  // Real Walking Route Calculation via Google Routes / Directions API with throttling
  useEffect(() => {
    if (!mapInstanceRef.current || !window.google?.maps) return;

    if (!directionsRendererRef.current) {
      directionsRendererRef.current = new window.google.maps.DirectionsRenderer({
        map: mapInstanceRef.current,
        suppressMarkers: true,
        polylineOptions: {
          strokeColor: "#a855f7",
          strokeOpacity: 0.88,
          strokeWeight: 5,
        },
      });
    }

    if (!userLocation || !selectedQuest) {
      directionsRendererRef.current.setDirections({ routes: [] });
      setCurrentRouteInfo(null);
      onRouteCalculated?.(null);
      return;
    }

    // Determine target location for route:
    // 1. If quest is completed or revealed, route leads to genuine destination.
    // 2. If destination is secret, check if there is an unlocked genuine waypoint!
    // 3. If no genuine intermediate waypoint exists, show general exploration area and directional text without fake route.
    const isRevealed = !selectedQuest.is_destination_secret || selectedQuest.status === "completed";

    // Find latest unlocked clue that has genuine coordinates
    const unlockedWaypoints = activeQuestClues.filter(
      (c) => c.is_unlocked && typeof c.latitude === "number" && typeof c.longitude === "number"
    );
    const targetWaypoint = unlockedWaypoints.length > 0 ? unlockedWaypoints[unlockedWaypoints.length - 1] : null;

    let targetLat: number | null = null;
    let targetLng: number | null = null;
    let targetType: "destination" | "waypoint" | "zone" = "zone";
    let targetName = selectedQuest.title;

    if (isRevealed) {
      targetLat = selectedQuest.latitude;
      targetLng = selectedQuest.longitude;
      targetType = "destination";
      targetName = selectedQuest.title;
    } else if (targetWaypoint && typeof targetWaypoint.latitude === "number" && typeof targetWaypoint.longitude === "number") {
      targetLat = targetWaypoint.latitude;
      targetLng = targetWaypoint.longitude;
      targetType = "waypoint";
      targetName = targetWaypoint.waypoint_name || `Hint #${targetWaypoint.step_order} Waypoint`;
    }

    // If no intermediate waypoint exists and destination is secret -> Show exploration zone without fake polyline
    if (targetLat === null || targetLng === null) {
      directionsRendererRef.current.setDirections({ routes: [] });
      const mysteryInfo: CalculatedRouteInfo = {
        distanceText: "Exploration Zone",
        durationText: "Follow hints to uncover location",
        durationMinutes: selectedQuest.estimated_minutes,
        isMystery: true,
        targetType: "zone",
        targetName: "General Exploration Area",
      };
      setCurrentRouteInfo(mysteryInfo);
      onRouteCalculated?.(mysteryInfo);
      return;
    }

    // Throttling: Only recalculate if user moved > 25 meters, or target changed, or > 25 seconds elapsed
    const now = Date.now();
    const prevOrigin = lastRouteOriginRef.current;
    const prevDest = lastRouteDestRef.current;
    const prevTime = lastRouteTimeRef.current;

    const originMovedMeters = prevOrigin
      ? haversineMeters(prevOrigin.lat, prevOrigin.lng, userLocation.latitude, userLocation.longitude)
      : 999;
    const destChanged = !prevDest || prevDest.lat !== targetLat || prevDest.lng !== targetLng;
    const timeElapsedSec = (now - prevTime) / 1000;

    if (!destChanged && originMovedMeters < 25 && timeElapsedSec < 25) {
      return; // Throttled to save API calls
    }

    lastRouteOriginRef.current = { lat: userLocation.latitude, lng: userLocation.longitude };
    lastRouteDestRef.current = { lat: targetLat, lng: targetLng };
    lastRouteTimeRef.current = now;

    const directionsService = new window.google.maps.DirectionsService();
    directionsService.route(
      {
        origin: { lat: userLocation.latitude, lng: userLocation.longitude },
        destination: { lat: targetLat, lng: targetLng },
        travelMode: window.google.maps.TravelMode.WALKING,
      },
      (result: google.maps.DirectionsResult | null, status: google.maps.DirectionsStatus) => {
        if (status === window.google.maps.DirectionsStatus.OK && result && result.routes.length > 0) {
          directionsRendererRef.current?.setDirections(result);
          const firstLeg = result.routes[0].legs[0];
          if (firstLeg && firstLeg.distance && firstLeg.duration) {
            const minutes = Math.max(1, Math.round(firstLeg.duration.value / 60));
            const legWithSteps = firstLeg as unknown as {
              steps?: Array<{ instructions?: string; distance?: { text?: string } }>;
            };
            const rawSteps = legWithSteps.steps || [];
            const steps = rawSteps.map((s) => ({
              instructions: s.instructions ? s.instructions.replace(/<[^>]+>/g, " ").trim() : "",
              distanceText: s.distance?.text || "",
            }));

            const routePayload: CalculatedRouteInfo = {
              distanceText: firstLeg.distance.text,
              durationText: firstLeg.duration.text,
              durationMinutes: minutes,
              isMystery: false,
              targetType,
              targetName,
              steps,
            };
            setCurrentRouteInfo(routePayload);
            onRouteCalculated?.(routePayload);
          } else {
            setCurrentRouteInfo(null);
            onRouteCalculated?.(null);
          }
        } else {
          // Graceful fallback on API route failure
          directionsRendererRef.current?.setDirections({ routes: [] });
          setCurrentRouteInfo(null);
          onRouteCalculated?.(null);
        }
      }
    );
  }, [userLocation, selectedQuest, activeQuestClues, onRouteCalculated]);

  // Recenter to live GPS
  const handleRecenterLocation = useCallback(() => {
    if (userLocation && mapInstanceRef.current) {
      mapInstanceRef.current.panTo({ lat: userLocation.latitude, lng: userLocation.longitude });
      mapInstanceRef.current.setZoom(16);
    }
    onRecenterUser?.();
  }, [userLocation, onRecenterUser]);

  // Recenter Route Bounds
  const handleRecenterRoute = useCallback(() => {
    if (!mapInstanceRef.current || !window.google?.maps) return;

    const bounds = new window.google.maps.LatLngBounds();
    if (userLocation) {
      bounds.extend({ lat: userLocation.latitude, lng: userLocation.longitude });
    }

    // Extend to unlocked waypoint or selected quest
    const unlockedWaypoints = activeQuestClues.filter(
      (c) => c.is_unlocked && typeof c.latitude === "number" && typeof c.longitude === "number"
    );
    if (unlockedWaypoints.length > 0) {
      const wp = unlockedWaypoints[unlockedWaypoints.length - 1];
      bounds.extend({ lat: wp.latitude!, lng: wp.longitude! });
    } else if (selectedQuest && (!selectedQuest.is_destination_secret || selectedQuest.status === "completed")) {
      bounds.extend({ lat: selectedQuest.latitude, lng: selectedQuest.longitude });
    }

    mapInstanceRef.current.fitBounds(bounds, { top: 60, bottom: 60, left: 60, right: 60 });
  }, [userLocation, activeQuestClues, selectedQuest]);

  // Zoom controls
  const handleZoomIn = useCallback(() => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setZoom((mapInstanceRef.current.getZoom() || 15) + 1);
    }
  }, []);

  const handleZoomOut = useCallback(() => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setZoom((mapInstanceRef.current.getZoom() || 15) - 1);
    }
  }, []);

  // Show active hint
  const handleShowHint = useCallback(() => {
    const unlocked = activeQuestClues.filter((c) => c.is_unlocked);
    if (unlocked.length > 0) {
      const latest = unlocked[unlocked.length - 1];
      setActiveClueCard(latest);
      if (typeof latest.latitude === "number" && typeof latest.longitude === "number" && mapInstanceRef.current) {
        mapInstanceRef.current.panTo({ lat: latest.latitude, lng: latest.longitude });
      }
    }
    onShowHint?.();
  }, [activeQuestClues, onShowHint]);

  return (
    <div className="w-full h-full min-h-[380px] relative rounded-2xl overflow-hidden shadow-inner bg-[#0b0918]">
      {/* Underlying Google Map Container */}
      <div
        ref={mapContainerRef}
        className="w-full h-full"
        role="region"
        aria-label="Google Maps Exploration View"
      />

      {/* Floating Map Controls Bar (Top Right) */}
      <div className="absolute top-3 right-3 z-30 flex flex-col items-end gap-1.5 pointer-events-auto">
        <div className="flex flex-col gap-1.5 bg-[#090814]/90 backdrop-blur-md p-1.5 rounded-2xl border border-purple-800/50 shadow-2xl">
          <button
            type="button"
            onClick={handleRecenterLocation}
            title="My Location"
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-950/70 text-amber-400 hover:text-white hover:bg-purple-800/80 transition cursor-pointer"
            aria-label="Recenter on My Location"
          >
            <Crosshair className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleZoomIn}
            title="Zoom In"
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-950/70 text-purple-200 hover:text-white hover:bg-purple-800/80 transition cursor-pointer"
            aria-label="Zoom In"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleZoomOut}
            title="Zoom Out"
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-950/70 text-purple-200 hover:text-white hover:bg-purple-800/80 transition cursor-pointer"
            aria-label="Zoom Out"
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleShowHint}
            title="Show Hint"
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-950/70 text-amber-300 hover:text-white hover:bg-amber-600/80 transition cursor-pointer"
            aria-label="Show Current Hint"
          >
            <HelpCircle className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleRecenterRoute}
            title="Recenter Route"
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-950/70 text-purple-300 hover:text-white hover:bg-purple-800/80 transition cursor-pointer"
            aria-label="Recenter Route Bounds"
          >
            <Navigation className="h-4 w-4" />
          </button>
          {selectedQuest && (!selectedQuest.is_destination_secret || selectedQuest.status === "completed") && (
            <a
              href={getGoogleMapsNavigationUrl(
                selectedQuest.latitude,
                selectedQuest.longitude,
                userLocation?.latitude,
                userLocation?.longitude
              )}
              target="_blank"
              rel="noreferrer"
              title="Open in Google Maps"
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-950/70 text-purple-300 hover:text-white hover:bg-purple-800/80 transition cursor-pointer"
              aria-label="Open in Google Maps"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
        </div>
      </div>

      {/* Floating Active Clue Card Popover (When question-mark marker is clicked) */}
      {activeClueCard && (
        <div className="absolute top-16 left-3 right-3 sm:left-6 sm:right-auto sm:max-w-sm z-30 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="rounded-2xl border border-amber-500/50 bg-[#090814]/95 backdrop-blur-md p-4 shadow-2xl space-y-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-purple-900 border border-amber-400 text-amber-400 text-xs font-black">
                  ?
                </span>
                <span className="text-xs font-bold text-amber-400">
                  Hint #{activeClueCard.step_order}
                </span>
                {activeClueCard.waypoint_name && (
                  <span className="text-[11px] text-purple-300/80 truncate max-w-[140px]">
                    • {activeClueCard.waypoint_name}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setActiveClueCard(null)}
                className="text-purple-400 hover:text-white transition p-1"
                aria-label="Close clue card"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="text-xs text-white leading-relaxed font-sans font-medium">
              &ldquo;{activeClueCard.clue}&rdquo;
            </p>

            <div className="flex items-center justify-between pt-1 border-t border-purple-900/50 text-[10px] text-purple-300/80">
              <span className="flex items-center gap-1 text-emerald-400 font-semibold">
                <Sparkles className="h-3 w-3" />
                Validated Public Waypoint
              </span>
              {typeof activeClueCard.latitude === "number" && typeof activeClueCard.longitude === "number" && (
                <button
                  type="button"
                  onClick={() => {
                    if (mapInstanceRef.current) {
                      mapInstanceRef.current.panTo({
                        lat: activeClueCard.latitude!,
                        lng: activeClueCard.longitude!,
                      });
                      mapInstanceRef.current.setZoom(17);
                    }
                  }}
                  className="text-amber-300 hover:underline font-semibold"
                >
                  Focus Waypoint
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Floating Route Follow Bar (Bottom Center) */}
      {currentRouteInfo && !currentRouteInfo.isMystery && (
        <div className="absolute bottom-3 left-3 right-3 sm:left-auto sm:right-auto sm:left-1/2 sm:-translate-x-1/2 z-20 pointer-events-auto">
          <div className="flex items-center gap-3 rounded-2xl border border-purple-700/60 bg-[#090814]/95 backdrop-blur-md px-4 py-2.5 shadow-2xl">
            <div className="flex items-center gap-2">
              <Footprints className="h-4 w-4 text-amber-400 shrink-0" />
              <div className="text-left">
                <p className="text-[10px] uppercase font-bold tracking-wider text-purple-300/80">
                  {currentRouteInfo.targetType === "waypoint" ? "Walking to Waypoint" : "Walking Route"}
                </p>
                <p className="text-xs font-extrabold text-white">
                  {currentRouteInfo.durationText}{" "}
                  <span className="text-purple-300 font-normal">
                    ({currentRouteInfo.distanceText} walk)
                  </span>
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                setIsFollowingRoute((prev) => !prev);
                handleRecenterRoute();
              }}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                isFollowingRoute
                  ? "bg-amber-500 text-black shadow-lg shadow-amber-500/20"
                  : "bg-purple-600 hover:bg-purple-500 text-white"
              }`}
            >
              <Navigation className="h-3.5 w-3.5" />
              <span>{isFollowingRoute ? "Following Route" : "Follow Route"}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
