"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  X,
  Compass,
  Clock,
  Sparkles,
  MapPin,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Info,
  Search,
  RotateCw,
  Building,
} from "lucide-react";
import type {
  AvailableMinutesType,
  DifficultyType,
  ExplorerType,
  QuestCreateRequest,
  NearbyCityItem,
} from "@/types/api";
import {
  getCurrentCoordinates,
  GeolocationError,
  type GeoCoordinates,
} from "@/lib/geo";
import {
  reverseGeocodeDetails,
  searchCityAutocomplete,
  getCityDetailsFromPlaceId,
  type ReverseGeocodeResult,
  type CitySuggestion,
} from "@/lib/maps";
import { api } from "@/lib/api";

export interface SelectedLocationData {
  latitude: number;
  longitude: number;
  accuracy: number;
  isManual: boolean;
  name: string;
  region: string;
  formattedAddress: string;
}

interface QuestSetupModalProps {
  userId: string;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (payload: QuestCreateRequest) => Promise<void>;
  initialLocation?: {
    latitude: number;
    longitude: number;
    accuracy: number;
    isManual: boolean;
  } | null;
  onRequireAuth?: (pendingPayload: QuestCreateRequest) => void;
  pendingPayload?: QuestCreateRequest | null;
}

const EXPLORER_ARCHETYPES: Array<{
  id: ExplorerType;
  title: string;
  icon: string;
  desc: string;
}> = [
  {
    id: "mystery",
    title: "Mystery",
    icon: "🔮",
    desc: "Cryptic riddles and overlooked historical oddities",
  },
  {
    id: "discovery",
    title: "Discovery",
    icon: "🧭",
    desc: "Architectural landmarks, civic curiosities, and hidden art",
  },
  {
    id: "nature",
    title: "Nature",
    icon: "🌿",
    desc: "Gardens, botanical sanctuaries, and urban tree canopy walks",
  },
  {
    id: "fitness",
    title: "Fitness",
    icon: "⚡",
    desc: "Brisk scenic paths, stair climbs, and dynamic trail loops",
  },
  {
    id: "social",
    title: "Social",
    icon: "🤝",
    desc: "Bustling plazas, community gathering circles, and markets",
  },
];

const DURATIONS: AvailableMinutesType[] = [15, 30, 60];

const DIFFICULTIES: Array<{ id: DifficultyType; title: string; badge: string }> = [
  { id: "easy", title: "Easy", badge: "100 XP Base" },
  { id: "medium", title: "Medium", badge: "200 XP Base" },
  { id: "hard", title: "Hard", badge: "350 XP Base" },
];

export function QuestSetupModal({
  userId,
  isOpen,
  onClose,
  onSubmit,
  initialLocation,
  onRequireAuth,
  pendingPayload,
}: QuestSetupModalProps) {
  const [duration, setDuration] = useState<AvailableMinutesType>(
    pendingPayload?.available_minutes ?? 30
  );
  const [archetype, setArchetype] = useState<ExplorerType>(
    pendingPayload?.explorer_type ?? "mystery"
  );
  const [difficulty, setDifficulty] = useState<DifficultyType>(
    pendingPayload?.difficulty ?? "medium"
  );

  // Location state
  const [coords, setCoords] = useState<GeoCoordinates | null>(
    initialLocation
      ? {
          latitude: initialLocation.latitude,
          longitude: initialLocation.longitude,
          accuracy: initialLocation.accuracy,
        }
      : null
  );
  const [isManual, setIsManual] = useState<boolean>(initialLocation?.isManual ?? false);
  const [geoDetails, setGeoDetails] = useState<ReverseGeocodeResult | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  // Dynamic nearby cities suggested from user's region
  const [nearbyCities, setNearbyCities] = useState<NearbyCityItem[]>([]);
  const [loadingNearbyCities, setLoadingNearbyCities] = useState(false);

  // City Autocomplete state
  const [searchQuery, setSearchQuery] = useState("");
  const [autocompleteResults, setAutocompleteResults] = useState<CitySuggestion[]>([]);
  const [searchingAutocomplete, setSearchingAutocomplete] = useState(false);
  const [selectedCityName, setSelectedCityName] = useState<string | null>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Restore pending payload if passed
  useEffect(() => {
    if (pendingPayload) {
      if (pendingPayload.available_minutes) setDuration(pendingPayload.available_minutes);
      if (pendingPayload.explorer_type) setArchetype(pendingPayload.explorer_type);
      if (pendingPayload.difficulty) setDifficulty(pendingPayload.difficulty);
    }
  }, [pendingPayload]);

  // Reverse geocode whenever GPS or coordinates change
  const fetchAddressAndNearby = async (lat: number, lng: number) => {
    try {
      const details = await reverseGeocodeDetails(lat, lng);
      setGeoDetails(details);
    } catch {
      // Graceful fallback
    }

    // Fetch genuine nearby cities from backend
    setLoadingNearbyCities(true);
    try {
      const cities = await api.getNearbyCities(lat, lng, 6);
      setNearbyCities(cities);
    } catch {
      setNearbyCities([]);
    } finally {
      setLoadingNearbyCities(false);
    }
  };

  // Initial geocode if initialLocation exists
  useEffect(() => {
    if (initialLocation && !geoDetails) {
      void fetchAddressAndNearby(initialLocation.latitude, initialLocation.longitude);
    }
  }, [initialLocation, geoDetails]);

  // Request native GPS with high accuracy
  async function handleAcquireGPS() {
    setGeoLoading(true);
    setGeoError(null);
    setSelectedCityName(null);

    try {
      const acquired = await getCurrentCoordinates();
      setCoords(acquired);
      setIsManual(false);
      await fetchAddressAndNearby(acquired.latitude, acquired.longitude);
    } catch (err: unknown) {
      const msg =
        err instanceof GeolocationError
          ? err.message
          : (err as Error)?.message || "Failed to acquire GPS location.";
      setGeoError(msg);
    } finally {
      setGeoLoading(false);
    }
  }

  // Handle autocomplete input change with debounce
  function handleSearchInputChange(val: string) {
    setSearchQuery(val);
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);

    if (val.trim().length < 2) {
      setAutocompleteResults([]);
      setSearchingAutocomplete(false);
      return;
    }

    setSearchingAutocomplete(true);
    debounceTimerRef.current = setTimeout(async () => {
      try {
        const results = await searchCityAutocomplete(val);
        setAutocompleteResults(results);
      } catch {
        setAutocompleteResults([]);
      } finally {
        setSearchingAutocomplete(false);
      }
    }, 350);
  }

  // Select city from autocomplete or dynamic suggestions
  async function handleSelectCity(city: {
    name: string;
    region?: string;
    country?: string;
    latitude?: number;
    longitude?: number;
    placeId?: string;
    place_id?: string | null;
  }) {
    setSearchQuery("");
    setAutocompleteResults([]);
    setSelectedCityName(city.name);
    setIsManual(true);
    setGeoError(null);

    const placeId = city.placeId || city.place_id;
    if (placeId) {
      const details = await getCityDetailsFromPlaceId(placeId);
      if (details) {
        setCoords({
          latitude: details.latitude,
          longitude: details.longitude,
          accuracy: 0,
        });
        setGeoDetails({
          formattedAddress: details.formattedAddress,
          city: details.name,
          state: details.region,
        });
        return;
      }
    }

    if (city.latitude !== undefined && city.longitude !== undefined) {
      setCoords({
        latitude: city.latitude,
        longitude: city.longitude,
        accuracy: 0,
      });
      setGeoDetails({
        formattedAddress: `${city.name}${city.region ? `, ${city.region}` : ""}${
          city.country ? `, ${city.country}` : ""
        }`,
        city: city.name,
        state: city.region,
        country: city.country,
      });
    }
  }

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    const payload: QuestCreateRequest = {
      user_id: userId,
      available_minutes: duration,
      explorer_type: archetype,
      difficulty: difficulty,
      latitude: coords?.latitude ?? null,
      longitude: coords?.longitude ?? null,
    };

    setSubmitting(true);
    try {
      await onSubmit(payload);
      onClose();
    } catch (err: unknown) {
      const msg = (err as Error)?.message || "Quest generation failed.";
      // Check if unauthorized 401: trigger auth modal and preserve draft
      if (
        msg.includes("401") ||
        msg.includes("Authentication required") ||
        msg.includes("Session is invalid")
      ) {
        if (onRequireAuth) {
          onRequireAuth(payload);
          return;
        }
      }
      setSubmitError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4 animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="setup-modal-title"
    >
      <div className="card-runic w-full max-w-lg rounded-t-3xl sm:rounded-3xl max-h-[92vh] overflow-y-auto border border-purple-600/40 shadow-2xl p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-purple-900/40 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-900/60 border border-purple-500/40 text-amber-400">
              <Compass className="h-5 w-5" />
            </div>
            <div>
              <h2 id="setup-modal-title" className="text-base font-bold text-white">
                Configure Expedition
              </h2>
              <p className="text-xs text-purple-300/70">
                AI Game Master will tailor your real-world quest
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg p-1.5 text-purple-400 hover:bg-purple-900/40 hover:text-white transition cursor-pointer"
            aria-label="Close modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleGenerate} className="space-y-5">
          {/* 1. Duration */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-purple-200 flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-amber-400" />
              Available Time
            </label>
            <div className="grid grid-cols-3 gap-2">
              {DURATIONS.map((mins) => (
                <button
                  type="button"
                  key={mins}
                  onClick={() => setDuration(mins)}
                  className={`flex flex-col items-center justify-center rounded-xl py-3 border transition cursor-pointer ${
                    duration === mins
                      ? "border-amber-400/80 bg-amber-500/20 text-amber-200 shadow-md shadow-amber-950/30"
                      : "border-purple-900/40 bg-purple-950/30 text-purple-300 hover:border-purple-700/60"
                  }`}
                >
                  <span className="text-sm font-bold">{mins} min</span>
                  <span className="text-[10px] text-purple-300/60">
                    {mins === 15 ? "Quick Sprint" : mins === 30 ? "Standard" : "Deep Trek"}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* 2. Archetype */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-purple-200 flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-amber-400" />
              Explorer Archetype
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {EXPLORER_ARCHETYPES.map((arch) => (
                <button
                  type="button"
                  key={arch.id}
                  onClick={() => setArchetype(arch.id)}
                  className={`flex items-start gap-2.5 rounded-xl p-3 text-left border transition cursor-pointer ${
                    archetype === arch.id
                      ? "border-purple-500/80 bg-purple-800/30 text-white shadow-md shadow-purple-950/40"
                      : "border-purple-900/40 bg-purple-950/20 text-purple-300 hover:border-purple-700/60"
                  }`}
                >
                  <span className="text-xl" role="img" aria-label={arch.title}>
                    {arch.icon}
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-white">{arch.title}</p>
                    <p className="text-[10px] text-purple-300/70 truncate">{arch.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* 3. Difficulty */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-purple-200">Difficulty Rating</label>
            <div className="grid grid-cols-3 gap-2">
              {DIFFICULTIES.map((diff) => (
                <button
                  type="button"
                  key={diff.id}
                  onClick={() => setDifficulty(diff.id)}
                  className={`rounded-xl py-2.5 px-2 border text-center transition cursor-pointer ${
                    difficulty === diff.id
                      ? "border-purple-400/80 bg-purple-600/25 text-white"
                      : "border-purple-900/40 bg-purple-950/30 text-purple-300 hover:border-purple-700/60"
                  }`}
                >
                  <p className="text-xs font-bold capitalize">{diff.title}</p>
                  <p className="text-[9px] text-purple-300/60">{diff.badge}</p>
                </button>
              ))}
            </div>
          </div>

          {/* 4. Location Permission, Detailed Geocoding & Dynamic Cities */}
          <div className="rounded-xl border border-purple-900/60 bg-purple-950/30 p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-purple-200 flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-amber-400" />
                Expedition Location
              </span>
              {coords ? (
                <span
                  className={`flex items-center gap-1 text-[11px] font-medium ${
                    isManual ? "text-amber-300" : "text-emerald-400"
                  }`}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {isManual
                    ? `Manual City (0 XP)`
                    : `Verified GPS (±${Math.round(coords.accuracy)}m)`}
                </span>
              ) : (
                <span className="text-[11px] text-purple-300/60">GPS or City required</span>
              )}
            </div>

            {/* GPS Acquire / Retry Button */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleAcquireGPS}
                disabled={geoLoading}
                className={`flex-1 flex items-center justify-center gap-2 rounded-lg border py-2.5 text-xs font-semibold transition disabled:opacity-50 cursor-pointer ${
                  !isManual && coords
                    ? "border-emerald-600/50 bg-emerald-950/30 text-emerald-200 hover:bg-emerald-900/40"
                    : "border-purple-700/50 bg-purple-900/40 text-purple-200 hover:bg-purple-800/40"
                }`}
              >
                {geoLoading ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />
                    <span>Acquiring GPS Signal...</span>
                  </>
                ) : (
                  <>
                    {coords && !isManual ? (
                      <RotateCw className="h-3.5 w-3.5 text-emerald-400" />
                    ) : (
                      <MapPin className="h-3.5 w-3.5 text-amber-400" />
                    )}
                    <span>{coords && !isManual ? "Retry GPS Location" : "Acquire Native GPS"}</span>
                  </>
                )}
              </button>
            </div>

            {/* Detailed Address & Component Tags Display */}
            {coords && (
              <div className="rounded-lg bg-black/50 border border-purple-900/60 p-3 space-y-2 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <p className="font-semibold text-white leading-tight">
                      {geoDetails?.formattedAddress ||
                        `${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}`}
                    </p>
                    {/* Granular location breakdown chips */}
                    <div className="flex flex-wrap gap-1 pt-1 text-[10px]">
                      {geoDetails?.locality && (
                        <span className="px-1.5 py-0.5 rounded bg-purple-900/40 text-purple-200 border border-purple-700/40">
                          {geoDetails.locality}
                        </span>
                      )}
                      {geoDetails?.district && (
                        <span className="px-1.5 py-0.5 rounded bg-purple-900/40 text-purple-300 border border-purple-700/40">
                          Dist: {geoDetails.district}
                        </span>
                      )}
                      {geoDetails?.state && (
                        <span className="px-1.5 py-0.5 rounded bg-purple-900/40 text-amber-300 border border-purple-700/40">
                          {geoDetails.state}
                        </span>
                      )}
                      {geoDetails?.country && (
                        <span className="px-1.5 py-0.5 rounded bg-purple-900/40 text-purple-300 border border-purple-700/40">
                          {geoDetails.country}
                        </span>
                      )}
                      {geoDetails?.postalCode && (
                        <span className="px-1.5 py-0.5 rounded bg-purple-900/40 font-mono text-purple-300 border border-purple-700/40">
                          {geoDetails.postalCode}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[10px] text-purple-300/70 border-t border-purple-900/40 pt-1.5">
                  <span>
                    {isManual
                      ? "⚠️ Manual coordinates cannot count as physical arrival or award verified XP."
                      : `GPS Accuracy: ±${Math.round(coords.accuracy)}m`}
                  </span>
                  <span className="font-mono text-purple-400">
                    {coords.latitude.toFixed(4)}, {coords.longitude.toFixed(4)}
                  </span>
                </div>
              </div>
            )}

            {/* Error banner */}
            {geoError && (
              <div className="rounded-lg bg-red-950/40 border border-red-800/50 p-2.5 text-[11px] text-red-200 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                <p>{geoError}</p>
              </div>
            )}

            {/* Dynamic Nearby Cities from User's Region */}
            {nearbyCities.length > 0 && (
              <div className="space-y-1.5 border-t border-purple-900/40 pt-2">
                <div className="flex items-center justify-between text-[11px] font-medium text-purple-300/80">
                  <span>Nearby Regional Cities (from your region):</span>
                  {loadingNearbyCities && (
                    <span className="text-[10px] text-amber-400 animate-pulse">Scanning...</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {nearbyCities.map((city) => {
                    const isSelected = selectedCityName === city.name;
                    return (
                      <button
                        key={`${city.name}-${city.latitude}`}
                        type="button"
                        onClick={() => void handleSelectCity(city)}
                        className={`text-[10px] px-2.5 py-1 rounded-lg border transition cursor-pointer flex items-center gap-1 ${
                          isSelected
                            ? "bg-amber-500/20 border-amber-400 text-amber-200 font-bold"
                            : "bg-purple-950/40 border-purple-800/60 text-purple-300 hover:border-purple-600"
                        }`}
                      >
                        <Building className="h-3 w-3 text-amber-400/80" />
                        <span>{city.name}</span>
                        {city.distance_km && (
                          <span className="text-[9px] text-purple-400">
                            ({Math.round(city.distance_km)}km)
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* City Autocomplete Search Input */}
            <div className="space-y-1.5 border-t border-purple-900/40 pt-2">
              <label
                htmlFor="city-autocomplete-input"
                className="text-[11px] text-purple-300/80 font-medium flex items-center gap-1"
              >
                <Search className="h-3 w-3 text-amber-400" />
                <span>Search Any City (with state & country context):</span>
              </label>
              <div className="relative">
                <input
                  id="city-autocomplete-input"
                  type="text"
                  value={searchQuery}
                  onChange={(e) => handleSearchInputChange(e.target.value)}
                  placeholder="Type city name (e.g. Kyoto, Munich, Seattle)..."
                  className="w-full pl-8 pr-8 py-2 rounded-lg bg-black/60 border border-purple-800/50 text-xs text-white placeholder-purple-400/40 focus:outline-none focus:border-amber-400 transition"
                />
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-purple-400/50" />
                {searchingAutocomplete && (
                  <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-amber-400" />
                )}
              </div>

              {/* Autocomplete Results Dropdown */}
              {autocompleteResults.length > 0 && (
                <div className="rounded-xl border border-purple-700/60 bg-[#0e091b] p-1.5 space-y-1 shadow-2xl max-h-44 overflow-y-auto z-20">
                  {autocompleteResults.map((item) => (
                    <button
                      key={item.placeId}
                      type="button"
                      onClick={() => void handleSelectCity(item)}
                      className="w-full p-2 text-left rounded-lg hover:bg-purple-900/40 transition flex items-center justify-between text-xs cursor-pointer group"
                    >
                      <div>
                        <p className="font-bold text-white group-hover:text-amber-200">
                          {item.name}
                        </p>
                        <p className="text-[10px] text-purple-300/70">{item.region}</p>
                      </div>
                      <span className="text-[10px] font-semibold text-purple-400">
                        {item.country}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {searchQuery.trim().length >= 2 &&
                !searchingAutocomplete &&
                autocompleteResults.length === 0 && (
                  <p className="text-[10px] text-purple-400/60 italic pl-1">
                    No matching cities found for &ldquo;{searchQuery}&rdquo;.
                  </p>
                )}
            </div>

            <div className="flex items-start gap-1.5 text-[10px] text-purple-300/60 pt-1">
              <Info className="h-3 w-3 shrink-0 mt-0.5 text-purple-400" />
              <span>
                Verified GPS proves presence and unlocks full XP rewards. Manual city selections
                allow story exploration with provisional 0 XP.
              </span>
            </div>
          </div>

          {/* Submit Error */}
          {submitError && (
            <div className="rounded-xl bg-red-950/50 border border-red-800/60 p-3 text-xs text-red-200 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
              <span>{submitError}</span>
            </div>
          )}

          {/* Primary Action Button */}
          <button
            type="submit"
            disabled={submitting}
            className="btn-primary-rpg w-full flex items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-bold text-white shadow-lg disabled:opacity-50 cursor-pointer"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-amber-300" />
                <span>Summoning Quest Narrative...</span>
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 text-amber-300" />
                <span>Summon Quest</span>
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
