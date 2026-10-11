"use client";

import React from "react";
import type { NearbyQuestItem } from "@/types/api";

interface RadarMapViewProps {
  center: { latitude: number; longitude: number };
  userLocation: { latitude: number; longitude: number; accuracy: number } | null;
  radiusMeters: number;
  quests: NearbyQuestItem[];
  selectedQuest: NearbyQuestItem | null;
  onSelectQuest: (quest: NearbyQuestItem) => void;
  activeQuestGeofenceMeters?: number;
}

export function RadarMapView({
  center,
  userLocation,
  radiusMeters,
  quests,
  selectedQuest,
  onSelectQuest,
  activeQuestGeofenceMeters = 100,
}: RadarMapViewProps) {
  // SVG view size: 400 x 400, center at (200, 200)
  const size = 400;
  const cx = 200;
  const cy = 200;

  // Scale: radiusMeters maps to 160px from center
  const scale = 160 / Math.max(radiusMeters, 100);

  // Convert lat/lon relative offset in meters to SVG coordinates
  // 1 deg latitude ≈ 111,000 meters
  // 1 deg longitude ≈ 111,000 * cos(lat) meters
  const centerLatRad = (center.latitude * Math.PI) / 180;
  const metersPerDegLat = 111000;
  const metersPerDegLon = 111000 * Math.cos(centerLatRad);

  const toSvgCoords = (lat: number, lon: number) => {
    const dNorth = (lat - center.latitude) * metersPerDegLat;
    const dEast = (lon - center.longitude) * metersPerDegLon;

    // SVG: X is East (positive), Y is North (negative, inverted Y)
    const x = cx + dEast * scale;
    const y = cy - dNorth * scale;
    return { x, y };
  };

  const userCoords = userLocation
    ? toSvgCoords(userLocation.latitude, userLocation.longitude)
    : { x: cx, y: cy };

  return (
    <div
      className="relative w-full h-full min-h-[380px] flex items-center justify-center bg-[#090715] rounded-2xl overflow-hidden border border-purple-900/30 shadow-inner select-none"
      role="region"
      aria-label="Interactive Quest Radar Map"
    >
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="w-full h-full max-h-[460px] p-2"
      >
        <defs>
          <radialGradient id="radarGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.12" />
            <stop offset="70%" stopColor="#6366f1" stopOpacity="0.04" />
            <stop offset="100%" stopColor="#0f0c24" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="gridLine" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.05" />
          </linearGradient>
        </defs>

        {/* Ambient Radar Background Circle */}
        <circle cx={cx} cy={cy} r={175} fill="url(#radarGlow)" />

        {/* Concentric Distance Rings */}
        <circle
          cx={cx}
          cy={cy}
          r={160}
          fill="none"
          stroke="#8b5cf6"
          strokeWidth="1.2"
          strokeDasharray="4 4"
          className="opacity-40 animate-[spin_60s_linear_infinite] origin-center"
        />
        <circle
          cx={cx}
          cy={cy}
          r={110}
          fill="none"
          stroke="#6366f1"
          strokeWidth="1"
          className="opacity-30"
        />
        <circle
          cx={cx}
          cy={cy}
          r={60}
          fill="none"
          stroke="#a855f7"
          strokeWidth="1"
          className="opacity-35"
        />

        {/* Crosshair Axes */}
        <line
          x1={cx}
          y1={25}
          x2={cx}
          y2={375}
          stroke="url(#gridLine)"
          strokeWidth="1"
        />
        <line
          x1={25}
          y1={cy}
          x2={375}
          y2={cy}
          stroke="url(#gridLine)"
          strokeWidth="1"
        />

        {/* Selected Quest Connection Walking Line */}
        {selectedQuest && (
          <line
            x1={userCoords.x}
            y1={userCoords.y}
            x2={toSvgCoords(selectedQuest.latitude, selectedQuest.longitude).x}
            y2={toSvgCoords(selectedQuest.latitude, selectedQuest.longitude).y}
            stroke="#a855f7"
            strokeWidth="2.5"
            strokeDasharray="6 4"
            className="opacity-80"
          />
        )}

        {/* Quest Markers */}
        {quests.map((quest, idx) => {
          const pt = toSvgCoords(quest.latitude, quest.longitude);
          const isSelected = selectedQuest?.title === quest.title;
          const isActive = quest.status === "active";
          const isCompleted = quest.status === "completed";

          // Geofence Circle for active or selected quest
          const geofenceRadiusSvg = Math.max(activeQuestGeofenceMeters * scale, 6);

          return (
            <g
              key={quest.id || `${quest.title}-${idx}`}
              onClick={() => onSelectQuest(quest)}
              className="cursor-pointer transition-transform hover:scale-110"
              style={{ transformOrigin: `${pt.x}px ${pt.y}px` }}
            >
              {/* Geofence 100m circle */}
              {(isActive || isSelected) && (
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r={geofenceRadiusSvg}
                  fill={isActive ? "#f59e0b" : "#8b5cf6"}
                  fillOpacity="0.2"
                  stroke={isActive ? "#fbbf24" : "#a855f7"}
                  strokeWidth="1.5"
                  strokeDasharray="3 3"
                />
              )}

              {/* Marker Halo */}
              <circle
                cx={pt.x}
                cy={pt.y}
                r={isSelected ? 14 : 10}
                fill={
                  isActive
                    ? "#f59e0b"
                    : isCompleted
                    ? "#3b82f6"
                    : "#10b981"
                }
                fillOpacity={isSelected ? 0.35 : 0.2}
              />

              {/* Marker Core */}
              <circle
                cx={pt.x}
                cy={pt.y}
                r={isSelected ? 7 : 5}
                fill={
                  isActive
                    ? "#fbbf24"
                    : isCompleted
                    ? "#60a5fa"
                    : "#34d399"
                }
                stroke="#ffffff"
                strokeWidth={isSelected ? 2 : 1.2}
              />
            </g>
          );
        })}

        {/* User Location Marker (Blue Core + Pulse) */}
        {userLocation && (
          <g>
            <circle
              cx={userCoords.x}
              cy={userCoords.y}
              r={12}
              fill="#38bdf8"
              fillOpacity="0.25"
              className="animate-ping origin-center"
              style={{ animationDuration: "2.5s" }}
            />
            <circle
              cx={userCoords.x}
              cy={userCoords.y}
              r={7}
              fill="#0ea5e9"
              stroke="#ffffff"
              strokeWidth="2"
            />
          </g>
        )}
      </svg>

      {/* Compass cardinal directions */}
      <span className="absolute top-3 text-[10px] font-mono tracking-widest text-purple-400/70">
        N
      </span>
      <span className="absolute bottom-3 text-[10px] font-mono tracking-widest text-purple-400/50">
        S
      </span>
      <span className="absolute left-3 text-[10px] font-mono tracking-widest text-purple-400/50">
        W
      </span>
      <span className="absolute right-3 text-[10px] font-mono tracking-widest text-purple-400/50">
        E
      </span>
    </div>
  );
}
