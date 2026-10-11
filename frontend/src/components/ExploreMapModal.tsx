"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  X,
  Compass,
  RefreshCw,
  ExternalLink,
  Shield,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Play,
  Eye,
  Crosshair,
} from "lucide-react";
import { useGoogleMaps, reverseGeocodeCoordinates, estimateWalkingMinutes, getGoogleMapsNavigationUrl } from "@/lib/maps";
import { GoogleMapView, type CalculatedRouteInfo } from "@/components/GoogleMapView";
import { RadarMapView } from "@/components/RadarMapView";
import { POPULAR_CITIES, getCurrentCoordinates, GeolocationError, type CityPreset } from "@/lib/geo";
import { api } from "@/lib/api";
import type { NearbyQuestItem, QuestResponse } from "@/types/api";

interface ExploreMapModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStartQuest: (questId: string) => Promise<void>;
  onGenerateQuestAtLocation?: (lat: number, lon: number) => void;
  activeQuest?: QuestResponse | null;
}

const RADIUS_PRESETS = [
  { label: "500m", value: 500 },
  { label: "1 km", value: 1000 },
  { label: "2 km", value: 2000 },
  { label: "5 km", value: 5000 },
];

export function ExploreMapModal({
  isOpen,
  onClose,
  onStartQuest,
  onGenerateQuestAtLocation,
}: ExploreMapModalProps) {
  const { isReady: isGoogleMapsReady } = useGoogleMaps();

  // Location State
  const [userLocation, setUserLocation] = useState<{
    latitude: number;
    longitude: number;
    accuracy: number;
    isManual: boolean;
  } | null>(null);

  const [addressLabel, setAddressLabel] = useState<string>("Locating explorer...");
  const [geoLoading, setGeoLoading] = useState<boolean>(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  // Map Filter State
  const [radiusMeters, setRadiusMeters] = useState<number>(1000);
  const [nearbyQuests, setNearbyQuests] = useState<NearbyQuestItem[]>([]);
  const [loadingQuests, setLoadingQuests] = useState<boolean>(false);
  const [selectedQuest, setSelectedQuest] = useState<NearbyQuestItem | null>(null);
  const [routeInfo, setRouteInfo] = useState<CalculatedRouteInfo | null>(null);
  const [startingQuestId, setStartingQuestId] = useState<string | null>(null);

  // Manual City fallback selector
  const [showCityPicker, setShowCityPicker] = useState<boolean>(false);

  // Acquire Native GPS
  const acquireLocation = useCallback(async () => {
    setGeoLoading(true);
    setGeoError(null);
    try {
      const coords = await getCurrentCoordinates();
      setUserLocation({
        latitude: coords.latitude,
        longitude: coords.longitude,
        accuracy: coords.accuracy,
        isManual: false,
      });
      const addr = await reverseGeocodeCoordinates(coords.latitude, coords.longitude);
      setAddressLabel(addr);
    } catch (err: unknown) {
      if (err instanceof GeolocationError) {
        setGeoError(err.message);
      } else {
        setGeoError("Unable to acquire GPS coordinates.");
      }
      // If no location set yet, fallback to default SF
      if (!userLocation) {
        const sf = POPULAR_CITIES[0];
        setUserLocation({
          latitude: sf.latitude,
          longitude: sf.longitude,
          accuracy: 0,
          isManual: true,
        });
        setAddressLabel(`${sf.name}, ${sf.region} (Manual Selection)`);
      }
    } finally {
      setGeoLoading(false);
    }
  }, [userLocation]);

  // Initial Location Fetch when opened
  useEffect(() => {
    if (!isOpen || userLocation) return;
    const timer = setTimeout(() => {
      void acquireLocation();
    }, 0);
    return () => clearTimeout(timer);
  }, [isOpen, userLocation, acquireLocation]);

  // Fetch Nearby Quests from Backend
  const fetchNearbyQuests = useCallback(async () => {
    if (!userLocation) return;
    setLoadingQuests(true);
    try {
      const res = await api.getNearbyQuests(
        userLocation.latitude,
        userLocation.longitude,
        radiusMeters
      );
      setNearbyQuests(res.items);

      // Auto-select active quest or nearest
      const activeItem = res.items.find((item) => item.status === "active");
      if (activeItem) {
        setSelectedQuest(activeItem);
      } else if (res.items.length > 0 && !selectedQuest) {
        setSelectedQuest(res.items[0]);
      }
    } catch (err) {
      console.warn("Could not fetch nearby quests:", err);
    } finally {
      setLoadingQuests(false);
    }
  }, [userLocation, radiusMeters, selectedQuest]);

  useEffect(() => {
    if (!isOpen || !userLocation) return;
    const timer = setTimeout(() => {
      void fetchNearbyQuests();
    }, 0);
    return () => clearTimeout(timer);
  }, [isOpen, userLocation, radiusMeters, fetchNearbyQuests]);

  if (!isOpen) return null;

  const currentCenter = userLocation
    ? { latitude: userLocation.latitude, longitude: userLocation.longitude }
    : { latitude: 37.7749, longitude: -122.4194 };

  const handleSelectCity = async (city: CityPreset) => {
    setUserLocation({
      latitude: city.latitude,
      longitude: city.longitude,
      accuracy: 0,
      isManual: true,
    });
    setAddressLabel(`${city.name}, ${city.region} (Manual Fallback)`);
    setGeoError(null);
    setShowCityPicker(false);
  };

  const handleStartQuestClick = async (quest: NearbyQuestItem) => {
    if (quest.id) {
      setStartingQuestId(quest.id);
      try {
        await onStartQuest(quest.id);
        onClose();
      } finally {
        setStartingQuestId(null);
      }
    } else if (onGenerateQuestAtLocation) {
      onGenerateQuestAtLocation(quest.latitude, quest.longitude);
      onClose();
    }
  };

  // Distance to selected quest
  const distanceText = selectedQuest
    ? selectedQuest.distance_meters < 1000
      ? `${Math.round(selectedQuest.distance_meters)}m`
      : `${(selectedQuest.distance_meters / 1000).toFixed(1)}km`
    : "";

  const etaMinutes = selectedQuest
    ? estimateWalkingMinutes(selectedQuest.distance_meters)
    : 0;

  // Verification Geofence Status (Inside/Outside 100m)
  const isInsideGeofence = selectedQuest
    ? selectedQuest.distance_meters <= selectedQuest.verification_radius_meters
    : false;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-2 sm:p-4 animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="explore-map-title"
    >
      <div className="relative flex flex-col w-full max-w-4xl h-[92vh] max-h-[820px] rounded-3xl border border-purple-800/40 bg-[#0d0b1a] shadow-2xl overflow-hidden text-slate-100">
        {/* Top Header */}
        <div className="flex items-center justify-between border-b border-purple-900/40 px-4 py-3 sm:px-6 bg-[#130f28]/70 backdrop-blur-md">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-purple-600 to-indigo-600 shadow-md">
              <Compass className="h-5 w-5 text-amber-300 animate-[spin_30s_linear_infinite]" />
            </div>
            <div>
              <h2 id="explore-map-title" className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
                Interactive Quest Map
                {isGoogleMapsReady ? (
                  <span className="text-[10px] font-semibold tracking-wide uppercase px-2 py-0.5 rounded-full bg-emerald-950/70 border border-emerald-500/40 text-emerald-400">
                    Google Maps Platform
                  </span>
                ) : (
                  <span className="text-[10px] font-semibold tracking-wide uppercase px-2 py-0.5 rounded-full bg-indigo-950/70 border border-indigo-500/40 text-indigo-400">
                    Tactical Radar
                  </span>
                )}
              </h2>
              <p className="text-xs text-purple-300/70 truncate max-w-[220px] sm:max-w-md">
                {addressLabel}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchNearbyQuests}
              disabled={loadingQuests}
              title="Refresh nearby quests"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-purple-800/40 bg-purple-950/40 text-purple-300 hover:bg-purple-900/40 transition disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loadingQuests ? "animate-spin" : ""}`} />
            </button>
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 bg-slate-800/50 text-slate-400 hover:text-white transition"
              aria-label="Close Explore Map"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Location Notice / GPS Status Banner */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 border-b border-purple-900/20 bg-purple-950/20 text-xs">
          <div className="flex items-center gap-2">
            {geoError ? (
              <span className="inline-flex items-center gap-1 text-red-400 font-medium" title={geoError}>
                <AlertTriangle className="h-3.5 w-3.5" />
                GPS Warning: {geoError.length > 55 ? `${geoError.slice(0, 52)}...` : geoError}
              </span>
            ) : userLocation?.isManual ? (
              <span className="inline-flex items-center gap-1 text-amber-400 font-medium">
                <AlertTriangle className="h-3.5 w-3.5" />
                Manual City Fallback (Simulated Mode — 0 XP)
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
                <Shield className="h-3.5 w-3.5" />
                Verified Native GPS (±{Math.round(userLocation?.accuracy || 0)}m)
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={acquireLocation}
              disabled={geoLoading}
              className="text-purple-300 hover:text-white underline font-medium"
            >
              {geoLoading ? "Acquiring GPS..." : "Recenter GPS"}
            </button>
            <span className="text-slate-600">|</span>
            <button
              onClick={() => setShowCityPicker(!showCityPicker)}
              className="text-purple-300 hover:text-white underline font-medium"
            >
              Change City
            </button>
          </div>
        </div>

        {/* City Picker Dropdown */}
        {showCityPicker && (
          <div className="p-3 border-b border-purple-900/40 bg-[#16122e] grid grid-cols-2 sm:grid-cols-4 gap-2">
            {POPULAR_CITIES.map((c) => (
              <button
                key={c.name}
                onClick={() => handleSelectCity(c)}
                className="px-2.5 py-1.5 text-left rounded-lg border border-purple-800/30 bg-purple-950/40 text-xs text-purple-200 hover:bg-purple-900/50 hover:border-purple-600 transition"
              >
                <div className="font-semibold text-white">{c.name}</div>
                <div className="text-[10px] text-purple-400/70">{c.region}</div>
              </button>
            ))}
          </div>
        )}

        {/* Main Content Area: Map + Bottom/Side Drawer */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden relative">
          {/* Map Surface */}
          <div className="flex-1 relative h-[50vh] md:h-auto p-2 sm:p-3">
            {isGoogleMapsReady ? (
              <GoogleMapView
                center={currentCenter}
                userLocation={userLocation}
                radiusMeters={radiusMeters}
                quests={nearbyQuests}
                selectedQuest={selectedQuest}
                onSelectQuest={(q) => {
                  setSelectedQuest(q);
                  setRouteInfo(null);
                }}
                activeQuestGeofenceMeters={selectedQuest?.verification_radius_meters || 100}
                onRouteCalculated={setRouteInfo}
              />
            ) : (
              <RadarMapView
                center={currentCenter}
                userLocation={userLocation}
                radiusMeters={radiusMeters}
                quests={nearbyQuests}
                selectedQuest={selectedQuest}
                onSelectQuest={(q) => {
                  setSelectedQuest(q);
                  setRouteInfo(null);
                }}
                activeQuestGeofenceMeters={selectedQuest?.verification_radius_meters || 100}
              />
            )}

            {/* Radius Preset Filter Controls Floating Over Map */}
            <div className="absolute top-5 left-5 z-20 flex items-center gap-1.5 p-1 rounded-xl bg-[#110e24]/80 backdrop-blur-md border border-purple-800/50 shadow-lg">
              <span className="text-[10px] font-semibold text-purple-300 px-1.5 hidden sm:inline">
                Radius:
              </span>
              {RADIUS_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  onClick={() => setRadiusMeters(preset.value)}
                  className={`px-2 py-1 rounded-lg text-xs font-semibold transition ${
                    radiusMeters === preset.value
                      ? "bg-purple-600 text-white shadow-sm"
                      : "text-purple-300/80 hover:text-white hover:bg-purple-900/40"
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            {/* Map Legend */}
            <div className="absolute bottom-5 left-5 z-20 hidden sm:flex items-center gap-3 px-3 py-1.5 rounded-xl bg-[#110e24]/80 backdrop-blur-md border border-purple-800/40 text-[10px] text-purple-200">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-400" /> Available
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-amber-400" /> Active
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-blue-400" /> Completed
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-sky-400" /> You
              </span>
            </div>
          </div>

          {/* Quest Cards / Detail Drawer */}
          <div className="w-full md:w-80 lg:w-96 border-t md:border-t-0 md:border-l border-purple-900/40 bg-[#100d24] flex flex-col overflow-y-auto p-4 space-y-3">
            {/* Selected Quest Header Card */}
            {selectedQuest ? (
              <div className="space-y-3">
                <div className="p-3.5 rounded-2xl border border-purple-800/50 bg-gradient-to-br from-purple-950/40 to-indigo-950/40 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                          selectedQuest.status === "active"
                            ? "bg-amber-950/70 border-amber-500/50 text-amber-400"
                            : selectedQuest.status === "completed"
                            ? "bg-blue-950/70 border-blue-500/50 text-blue-400"
                            : "bg-emerald-950/70 border-emerald-500/50 text-emerald-400"
                        }`}
                      >
                        {selectedQuest.status}
                      </span>
                      {selectedQuest.is_simulated && (
                        <span className="text-[10px] font-medium uppercase px-1.5 py-0.5 rounded bg-purple-950/80 border border-purple-800/50 text-purple-300">
                          Demo POI
                        </span>
                      )}
                    </div>
                    <span className="text-xs font-semibold text-amber-300 flex items-center gap-1">
                      <Sparkles className="h-3 w-3" />
                      +{selectedQuest.reward_xp} XP
                    </span>
                  </div>

                  <div>
                    <h3 className="font-bold text-white text-sm line-clamp-1">
                      {selectedQuest.title}
                    </h3>
                    <p className="text-xs text-purple-300/80 line-clamp-2 mt-0.5">
                      {selectedQuest.description}
                    </p>
                  </div>

                  {/* Geofence Status Pill (matches authoritative verification radius) */}
                  <div
                    className={`flex items-center justify-between px-2.5 py-1.5 rounded-xl border text-xs font-medium ${
                      isInsideGeofence
                        ? "bg-emerald-950/60 border-emerald-500/50 text-emerald-300"
                        : "bg-purple-950/50 border-purple-800/40 text-purple-300/90"
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <Crosshair className="h-3.5 w-3.5" />
                      {isInsideGeofence
                        ? `Inside ${selectedQuest.verification_radius_meters}m Zone (Ready to Verify)`
                        : `Outside ${selectedQuest.verification_radius_meters}m Zone (${distanceText} away)`}
                    </span>
                    <span className="font-mono text-[11px] font-bold">
                      {distanceText}
                    </span>
                  </div>

                  {/* Walking Route ETA: Verified Google Route Duration vs Straight-Line Estimate */}
                  <div className="flex items-center justify-between pt-1 text-xs text-purple-300/70">
                    <span>
                      {selectedQuest.is_destination_secret
                        ? "Mystery Destination (follow hints)"
                        : routeInfo && !routeInfo.isMystery
                        ? `Route: ${routeInfo.durationText} (${routeInfo.distanceText})`
                        : selectedQuest.distance_meters > 0
                        ? `${selectedQuest.distance_meters > 1000 ? (selectedQuest.distance_meters / 1000).toFixed(1) + "km" : Math.round(selectedQuest.distance_meters) + "m"}`
                        : "Distance N/A"}
                    </span>
                    {!selectedQuest.is_destination_secret && (
                      <a
                        href={getGoogleMapsNavigationUrl(
                          selectedQuest.latitude,
                          selectedQuest.longitude,
                          userLocation?.latitude,
                          userLocation?.longitude
                        )}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-purple-300 hover:text-white underline"
                      >
                        Google Maps
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>

                  {/* Action Button */}
                  {selectedQuest.status === "active" ? (
                    <button
                      onClick={onClose}
                      className="w-full flex items-center justify-center gap-1.5 py-2.5 px-4 rounded-xl bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 font-bold text-xs text-slate-950 shadow-md transition"
                    >
                      <Eye className="h-4 w-4" />
                      View Active Clues & Verify
                    </button>
                  ) : selectedQuest.status === "completed" ? (
                    <div className="flex items-center justify-center gap-1.5 py-2 text-xs text-blue-300 bg-blue-950/30 rounded-xl border border-blue-800/30">
                      <CheckCircle2 className="h-4 w-4" />
                      Expedition Completed
                    </div>
                  ) : (
                    <button
                      onClick={() => handleStartQuestClick(selectedQuest)}
                      disabled={startingQuestId === selectedQuest.id}
                      className="w-full flex items-center justify-center gap-1.5 py-2.5 px-4 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 font-bold text-xs text-white shadow-md transition disabled:opacity-50"
                    >
                      <Play className="h-4 w-4 fill-white" />
                      {selectedQuest.id ? "Start This Quest" : "Generate Expedition"}
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-2xl border border-purple-900/30 bg-purple-950/20 text-center text-xs text-purple-300/70">
                Select any marker on the map to inspect destination details, distance, and walking route.
              </div>
            )}

            {/* List of Other Nearby Locations */}
            <div className="space-y-2 flex-1">
              <h4 className="text-xs font-semibold text-purple-300 uppercase tracking-wider flex items-center justify-between">
                <span>Nearby Expeditions ({nearbyQuests.length})</span>
                <span className="text-[10px] text-purple-400/60 lowercase">
                  within {radiusMeters}m
                </span>
              </h4>

              {nearbyQuests.length === 0 && !loadingQuests ? (
                <div className="p-4 text-center text-xs text-purple-300/50 rounded-xl border border-dashed border-purple-900/40">
                  No expeditions found in this radius. Try selecting 2 km or 5 km.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {nearbyQuests.map((quest, idx) => {
                    const isSelected = selectedQuest?.title === quest.title;
                    const dText =
                      quest.distance_meters < 1000
                        ? `${Math.round(quest.distance_meters)}m`
                        : `${(quest.distance_meters / 1000).toFixed(1)}km`;

                    return (
                      <button
                        key={quest.id || `${quest.title}-${idx}`}
                        onClick={() => setSelectedQuest(quest)}
                        className={`w-full text-left p-2.5 rounded-xl border transition flex items-center justify-between ${
                          isSelected
                            ? "bg-purple-900/40 border-purple-500/70 text-white"
                            : "bg-[#14102c]/50 border-purple-900/30 text-purple-200/80 hover:bg-purple-900/20"
                        }`}
                      >
                        <div className="truncate mr-2">
                          <div className="font-semibold text-xs truncate">
                            {quest.title}
                          </div>
                          <div className="text-[10px] text-purple-400/70">
                            {quest.difficulty} • {quest.estimated_minutes} min • +{quest.reward_xp} XP
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="font-mono text-xs font-bold text-amber-300">
                            {dText}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
