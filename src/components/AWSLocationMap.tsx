"use client";

import React, { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { Map, Marker, GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

interface Coords {
  lat: number;
  lng: number;
}

interface Shop {
  slug: string;
  name: string;
  category?: string;
  rating?: number;
  wallet: string;
}

interface AWSLocationMapProps {
  customerCoords: Coords;
  shops: Shop[];
  searchRadius: number; // km
  selectedShop: Shop | null;
  onSelectShop: (shop: Shop) => void;
  activeReceipt: any;
  getShopCoords: (slug: string | null | undefined) => Coords;
  getDistanceKm: (slug: string | null | undefined) => number;
  showControls?: boolean;
}

// Helper to generate a mathematically precise GeoJSON polygon of a circle
const createGeoJSONCircle = (center: [number, number], radiusInKm: number, points = 64) => {
  const [lng, lat] = center;
  const coordinates = [];
  
  // Earth's radius in km is ~6371
  const dDivR = radiusInKm / 6371;
  const latRad = (lat * Math.PI) / 180;
  const lngRad = (lng * Math.PI) / 180;

  for (let i = 0; i < points; i++) {
    const bearing = (i / points) * 2 * Math.PI;
    
    const nextLatRad = Math.asin(
      Math.sin(latRad) * Math.cos(dDivR) +
      Math.cos(latRad) * Math.sin(dDivR) * Math.cos(bearing)
    );
    
    const nextLngRad = lngRad + Math.atan2(
      Math.sin(bearing) * Math.sin(dDivR) * Math.cos(latRad),
      Math.cos(dDivR) - Math.sin(latRad) * Math.sin(nextLatRad)
    );

    const nextLat = (nextLatRad * 180) / Math.PI;
    const nextLng = (nextLngRad * 180) / Math.PI;
    coordinates.push([nextLng, nextLat]);
  }
  
  // Close the polygon
  coordinates.push(coordinates[0]);

  return {
    type: "Feature" as const,
    geometry: {
      type: "Polygon" as const,
      coordinates: [coordinates]
    },
    properties: {}
  };
};

export default function AWSLocationMap({
  customerCoords,
  shops,
  searchRadius,
  selectedShop,
  onSelectShop,
  activeReceipt,
  getShopCoords,
  getDistanceKm,
  showControls = false
}: AWSLocationMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const customerMarkerRef = useRef<Marker | null>(null);
  const driverMarkerRef = useRef<Marker | null>(null);
  
  const [hoveredShopInfo, setHoveredShopInfo] = useState<{ name: string; category?: string; distance: number; rating?: number } | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);

  const apiKey = process.env.NEXT_PUBLIC_AWS_MAP_API_KEY || "";
  const region = process.env.NEXT_PUBLIC_AWS_MAP_REGION || "us-east-1";
  const mapName = process.env.NEXT_PUBLIC_AWS_MAP_NAME || "PortalPayDarkMap";

  // Compute Animated Driver progress position during transit
  const driverPercentProgress = React.useMemo(() => {
    if (!activeReceipt) return 0;
    const status = activeReceipt.localDelivery?.deliveryStatus || "pending";
    if (status === "accepted") return 0.25;
    if (status === "in_transit") return 0.65;
    if (status === "completed") return 1.00;
    return 0;
  }, [activeReceipt]);

  // Compute actual lat/lng along driver dispatch path
  const driverCoords = React.useMemo(() => {
    if (!activeReceipt || !activeReceipt.shopSlug) return null;
    const shopSlug = activeReceipt.shopSlug;
    const shopC = getShopCoords(shopSlug);
    if (!shopC) return null;
    
    // Linear interpolate coordinates from kitchen to customer coordinates
    const dLat = customerCoords.lat - shopC.lat;
    const dLng = customerCoords.lng - shopC.lng;
    return {
      lat: shopC.lat + dLat * driverPercentProgress,
      lng: shopC.lng + dLng * driverPercentProgress
    };
  }, [activeReceipt, driverPercentProgress, customerCoords, getShopCoords]);

  // 1. Initialize MapLibre GL Map
  useEffect(() => {
    if (!mapContainerRef.current || !apiKey) return;

    // Direct Amazon Location Service v2 style descriptor with API Key
    // Valid v2 styles: "Standard", "Monochrome", "Hybrid", "Satellite"
    // Scoped with color-scheme=Dark for our premium delivery aesthetic
    const mapStyle = "Standard";
    const styleUrl = `https://maps.geo.${region}.amazonaws.com/v2/styles/${mapStyle}/descriptor?key=${apiKey}&color-scheme=Dark`;

    // Intercept outgoing tile, glyph, and source requests to append API key
    // This resolves authorization blank grey tile glitches for ALS style JSON templates
    const transformRequest = (url: string) => {
      if (url.includes("amazonaws.com")) {
        if (!url.includes("key=")) {
          const separator = url.includes("?") ? "&" : "?";
          return {
            url: `${url}${separator}key=${apiKey}`
          };
        }
      }
      return { url };
    };

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: styleUrl,
      center: [customerCoords.lng, customerCoords.lat],
      zoom: 13.2,
      pitch: 30, // 3D tilt for cinematic HUD style
      validateStyle: false,
      attributionControl: false, // Turned off to prevent clunky white box overlapping controls
      transformRequest
    });

    mapRef.current = map;

    // Capture error events on the map instance to display high-fidelity diagnostics
    map.on("error", (e: any) => {
      console.error("MapLibre error event:", e);
      setMapError(e.error?.message || e.message || "Failed to load map assets or tiles.");
    });

    // Load GeoJSON layers on style load
    map.on("load", () => {
      map.resize();
      // A. Add Radius Boundary Source & Layer
      const circleGeoJSON = createGeoJSONCircle([customerCoords.lng, customerCoords.lat], searchRadius);
      
      map.addSource("search-radius", {
        type: "geojson",
        data: circleGeoJSON
      });

      map.addLayer({
        id: "radius-fill",
        type: "fill",
        source: "search-radius",
        paint: {
          "fill-color": "#35ff7c",
          "fill-opacity": 0.03
        }
      });

      map.addLayer({
        id: "radius-stroke",
        type: "line",
        source: "search-radius",
        paint: {
          "line-color": "#35ff7c",
          "line-width": 1.5,
          "line-dasharray": [3, 3]
        }
      });

      // B. Setup Transit Polyline Source & Layer (Default empty)
      map.addSource("transit-route", {
        type: "geojson",
        data: {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: []
          },
          properties: {}
        }
      });

      map.addLayer({
        id: "route-line",
        type: "line",
        source: "transit-route",
        paint: {
          "line-color": "#3b82f6",
          "line-width": 3,
          "line-opacity": 0.7
        }
      });

      map.addLayer({
        id: "route-glow",
        type: "line",
        source: "transit-route",
        paint: {
          "line-color": "#35ff7c",
          "line-width": 8,
          "line-opacity": 0.15,
          "line-blur": 4
        }
      });
    });

    // Add Navigation Control widget conditionally if enabled (unblocks layout from overlays)
    if (showControls) {
      map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-right");
    }

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [apiKey, showControls]);

  // 2. Sync / Update Search Radius Circle Layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const source = map.getSource("search-radius") as GeoJSONSource;
    if (source && map.isStyleLoaded()) {
      const circleGeoJSON = createGeoJSONCircle([customerCoords.lng, customerCoords.lat], searchRadius);
      source.setData(circleGeoJSON);
    }
  }, [searchRadius, customerCoords]);

  // 3. Render and Update Customer & Driver markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Clear old customer marker
    if (customerMarkerRef.current) {
      customerMarkerRef.current.remove();
    }

    // Render dropoff marker only if an active job/offer exists
    if (activeReceipt) {
      const el = document.createElement("div");
      el.className = "flex items-center justify-center text-xl bg-[#35ff7c]/20 border border-[#35ff7c] w-8 h-8 rounded-full shadow-lg shadow-[#35ff7c]/20 relative cursor-help";
      el.innerHTML = `
        <span class="absolute inset-0 bg-[#35ff7c] rounded-full animate-ping opacity-15"></span>
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#35ff7c" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
      `;

      const customerMarker = new maplibregl.Marker({ element: el })
        .setLngLat([customerCoords.lng, customerCoords.lat])
        .addTo(map);

      customerMarkerRef.current = customerMarker;
    }

    // Update / Render Active Driver marker 🛵 during transit or standby
    if (driverMarkerRef.current) {
      driverMarkerRef.current.remove();
      driverMarkerRef.current = null;
    }

    // If an active job/offer is rendering and we have active transit coords, draw vehicle beacon there.
    // Otherwise, draw the vehicle beacon at the driver's current simulated coordinates (customerCoords).
    const activeDriverCoords = (activeReceipt && driverCoords) ? driverCoords : customerCoords;

    if (activeDriverCoords) {
      const dEl = document.createElement("div");
      dEl.className = "flex items-center justify-center text-xs font-bold bg-[#35ff7c] text-black border border-white/20 w-8 h-8 rounded-xl shadow-2xl relative cursor-pointer";
      dEl.innerHTML = `
        <span class="absolute inset-0 bg-[#35ff7c] rounded-xl animate-ping opacity-25"></span>
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#000000" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
      `;

      const driverMarker = new maplibregl.Marker({ element: dEl })
        .setLngLat([activeDriverCoords.lng, activeDriverCoords.lat])
        .addTo(map);

      driverMarkerRef.current = driverMarker;
    }

    // Draw routing line if active job or offer is present
    if (activeReceipt && activeReceipt.shopSlug) {
      const routeSource = map.getSource("transit-route") as GeoJSONSource;
      if (routeSource && map.isStyleLoaded()) {
        const shopSlug = activeReceipt.shopSlug;
        const shopC = getShopCoords(shopSlug);
        if (shopC) {
          routeSource.setData({
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates: [
                [shopC.lng, shopC.lat],
                [customerCoords.lng, customerCoords.lat]
              ]
            },
            properties: {}
          });
        }
      }
    } else {
      // Clear route line
      const routeSource = map.getSource("transit-route") as GeoJSONSource;
      if (routeSource && map.isStyleLoaded()) {
        routeSource.setData({
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: []
          },
          properties: {}
        });
      }
    }
  }, [customerCoords, activeReceipt, driverCoords]);

  // Center map camera viewport smoothly when customer coordinates update
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({
      center: [customerCoords.lng, customerCoords.lat],
      zoom: 13.2,
      essential: true
    });
  }, [customerCoords]);

  // 4. Render Merchant Kitchen pins dynamically
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Clear old kitchen pins
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    // Don't render general kitchen pins if selected a shop or active receipt is shown
    if (selectedShop || activeReceipt) return;

    shops.forEach((shop) => {
      if (!shop || !shop.slug) return;
      const coords = getShopCoords(shop.slug);
      const distance = getDistanceKm(shop.slug);

      // Only plot if within the radius boundary
      if (distance > searchRadius) return;

      const el = document.createElement("div");
      el.className = "flex items-center justify-center text-sm bg-[#3b82f6]/20 hover:bg-[#35ff7c]/20 border border-[#3b82f6] hover:border-[#35ff7c] w-8 h-8 rounded-full shadow-lg transition-all duration-300 cursor-pointer";
      el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4"/><path d="M2 7h20"/></svg>`;

      el.addEventListener("click", () => {
        onSelectShop(shop);
      });

      el.addEventListener("mouseenter", () => {
        setHoveredShopInfo({
          name: shop.name,
          category: shop.category,
          distance: distance,
          rating: shop.rating
        });
      });

      el.addEventListener("mouseleave", () => {
        setHoveredShopInfo(null);
      });

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([coords.lng, coords.lat])
        .addTo(map);

      markersRef.current.push(marker);
    });
  }, [shops, searchRadius, selectedShop, activeReceipt, customerCoords]);

  return (
    <div className="w-full h-full relative">
      <div ref={mapContainerRef} className="w-full h-full rounded-2xl overflow-hidden" />
      
      {/* Floating vector map loading placeholder (styled) */}
      {!apiKey && (
        <div className="absolute inset-0 bg-[#0c0d13] rounded-2xl flex flex-col items-center justify-center p-6 border border-white/5 text-center space-y-3 z-[100]">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#4b5563" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" className="text-muted-foreground/60"><path d="M14.12 3.88 16 2v18l-6-3-6 3V6l6-3Z"/><path d="M9.41 10.41 14 15"/><path d="m14 4-4 4"/></svg>
          <p className="text-xs text-muted-foreground max-w-xs leading-relaxed">
            Please define your AWS Amazon Location API credentials in `.env.local` to unlock high-fidelity vector mapping.
          </p>
        </div>
      )}

      {/* Floating hovered pin HUD cards */}
      {hoveredShopInfo && (
        <div className="absolute bottom-3 left-3 right-3 bg-[#11121a]/95 border border-white/10 p-3 rounded-xl text-xs space-y-1 z-30 shadow-2xl backdrop-blur-md transition-all font-sans">
          <div className="font-bold text-white flex justify-between">
            <span>{hoveredShopInfo.name}</span>
            <span className="text-[#35ff7c]">★ {hoveredShopInfo.rating || "4.5"}</span>
          </div>
          <div className="text-muted-foreground flex justify-between font-mono text-[10px]">
            <span>{hoveredShopInfo.category || "Online Kitchen"}</span>
            <span>Distance: {hoveredShopInfo.distance}km</span>
          </div>
        </div>
      )}

      {/* Map Diagnostics Alert overlay */}
      {mapError && (
        <div className="absolute inset-x-3 bottom-3 bg-red-950/90 border border-red-500/30 p-3.5 rounded-xl text-xs z-50 shadow-2xl backdrop-blur-md transition-all font-mono text-red-200 flex flex-col space-y-1">
          <div className="font-bold flex items-center gap-1.5 text-red-400">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" className="shrink-0"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            <span>MAP RUNTIME DIAGNOSTIC WARNING</span>
          </div>
          <span className="text-[10px] break-all leading-normal">{mapError}</span>
          <div className="mt-1 text-[9px] text-amber-300 font-sans border-t border-red-500/20 pt-1 leading-normal">
            <strong>Adblocker Warning:</strong> If you have Brave Shields, uBlock Origin, or Adblock active, they block requests to Amazon Location Service endpoints (ERR_BLOCKED_BY_CLIENT). Please disable shields/adblock for localhost to unlock map tiles.
          </div>
        </div>
      )}
    </div>
  );
}
