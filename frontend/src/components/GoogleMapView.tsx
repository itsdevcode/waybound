"use client";

import React, { useEffect, useRef } from "react";
import type { NearbyQuestItem } from "@/types/api";

interface GoogleMapViewProps {
  center: { latitude: number; longitude: number };
  userLocation: { latitude: number; longitude: number; accuracy: number } | null;
  radiusMeters: number;
  quests: NearbyQuestItem[];
  selectedQuest: NearbyQuestItem | null;
  onSelectQuest: (quest: NearbyQuestItem) => void;
  activeQuestGeofenceMeters?: number;
}

export function GoogleMapView({
  center,
  userLocation,
  radiusMeters,
  quests,
  selectedQuest,
  onSelectQuest,
  activeQuestGeofenceMeters = 100,
}: GoogleMapViewProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const userMarkerRef = useRef<google.maps.Marker | null>(null);
  const radiusCircleRef = useRef<google.maps.Circle | null>(null);
  const geofenceCircleRef = useRef<google.maps.Circle | null>(null);
  const questMarkersRef = useRef<google.maps.Marker[]>([]);
  const directionsRendererRef = useRef<google.maps.DirectionsRenderer | null>(null);

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current || typeof window === "undefined" || !window.google?.maps) return;

    if (!mapInstanceRef.current) {
      mapInstanceRef.current = new window.google.maps.Map(mapContainerRef.current, {
        center: { lat: center.latitude, lng: center.longitude },
        zoom: radiusMeters <= 1000 ? 15 : radiusMeters <= 2000 ? 14 : 13,
        mapId: "DEMO_MAP_ID",
        disableDefaultUI: false,
        zoomControl: true,
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

  // Update Center and Zoom on location / radius change
  useEffect(() => {
    if (!mapInstanceRef.current || !window.google?.maps) return;
    mapInstanceRef.current.panTo({ lat: center.latitude, lng: center.longitude });
    const zoomLevel = radiusMeters <= 500 ? 16 : radiusMeters <= 1000 ? 15 : radiusMeters <= 2000 ? 14 : 13;
    mapInstanceRef.current.setZoom(zoomLevel);
  }, [center.latitude, center.longitude, radiusMeters]);

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
      fillOpacity: 0.12,
      strokeColor: "#a78bfa",
      strokeOpacity: 0.6,
      strokeWeight: 1.5,
    });

    return () => {
      if (radiusCircleRef.current) {
        radiusCircleRef.current.setMap(null);
      }
    };
  }, [center.latitude, center.longitude, radiusMeters]);

  // Update User Location Marker (Blue pulsing dot)
  useEffect(() => {
    if (!mapInstanceRef.current || !window.google?.maps || !userLocation) {
      if (userMarkerRef.current) {
        userMarkerRef.current.setMap(null);
        userMarkerRef.current = null;
      }
      return;
    }

    const position = { lat: userLocation.latitude, lng: userLocation.longitude };
    if (!userMarkerRef.current) {
      userMarkerRef.current = new window.google.maps.Marker({
        position,
        map: mapInstanceRef.current,
        title: "Your Location",
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
  }, [userLocation]);

  // Update Quest Markers
  useEffect(() => {
    if (!mapInstanceRef.current || !window.google?.maps) return;

    // Clear existing quest markers
    questMarkersRef.current.forEach((m) => m.setMap(null));
    questMarkersRef.current = [];

    quests.forEach((quest) => {
      const isSelected = selectedQuest?.title === quest.title;
      let markerColor = "#10b981"; // Emerald for available
      if (quest.status === "active") markerColor = "#f59e0b"; // Amber for active
      else if (quest.status === "completed") markerColor = "#3b82f6"; // Blue for completed
      else if (quest.status === "locked") markerColor = "#64748b"; // Slate for locked

      const marker = new window.google.maps.Marker({
        position: { lat: quest.latitude, lng: quest.longitude },
        map: mapInstanceRef.current,
        title: quest.title,
        icon: {
          path: window.google.maps.SymbolPath.BACKWARD_CLOSED_ARROW,
          scale: isSelected ? 7 : 5.5,
          fillColor: markerColor,
          fillOpacity: 0.95,
          strokeColor: isSelected ? "#ffffff" : "#1f1a36",
          strokeWeight: isSelected ? 2.5 : 1.5,
        },
        zIndex: quest.status === "active" ? 90 : isSelected ? 80 : 50,
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

  // Active Quest Geofence Circle (100m Authoritative Verification Zone)
  useEffect(() => {
    if (!mapInstanceRef.current || !window.google?.maps) return;

    if (geofenceCircleRef.current) {
      geofenceCircleRef.current.setMap(null);
      geofenceCircleRef.current = null;
    }

    const activeOrSelected = quests.find((q) => q.status === "active") || selectedQuest;
    if (activeOrSelected) {
      geofenceCircleRef.current = new window.google.maps.Circle({
        map: mapInstanceRef.current,
        center: { lat: activeOrSelected.latitude, lng: activeOrSelected.longitude },
        radius: activeQuestGeofenceMeters,
        fillColor: "#f59e0b",
        fillOpacity: 0.18,
        strokeColor: "#fbbf24",
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

  // Walking Route Line / Directions
  useEffect(() => {
    if (!mapInstanceRef.current || !window.google?.maps) return;

    if (!directionsRendererRef.current) {
      directionsRendererRef.current = new window.google.maps.DirectionsRenderer({
        map: mapInstanceRef.current,
        suppressMarkers: true,
        polylineOptions: {
          strokeColor: "#a855f7",
          strokeOpacity: 0.8,
          strokeWeight: 4,
        },
      });
    }

    if (!userLocation || !selectedQuest) {
      directionsRendererRef.current.setDirections({ routes: [] });
      return;
    }

    const directionsService = new window.google.maps.DirectionsService();
    directionsService.route(
      {
        origin: { lat: userLocation.latitude, lng: userLocation.longitude },
        destination: { lat: selectedQuest.latitude, lng: selectedQuest.longitude },
        travelMode: window.google.maps.TravelMode.WALKING,
      },
      (result: google.maps.DirectionsResult | null, status: google.maps.DirectionsStatus) => {
        if (status === window.google.maps.DirectionsStatus.OK && result) {
          directionsRendererRef.current?.setDirections(result);
        } else {
          directionsRendererRef.current?.setDirections({ routes: [] });
        }
      }
    );
  }, [userLocation, selectedQuest]);

  return (
    <div
      ref={mapContainerRef}
      className="w-full h-full min-h-[380px] rounded-2xl overflow-hidden shadow-inner bg-[#0b0918]"
      role="region"
      aria-label="Google Maps Exploration View"
    />
  );
}
