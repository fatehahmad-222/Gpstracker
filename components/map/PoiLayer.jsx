"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Marker, Popup, useMap, useMapEvents } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import L from "leaflet";
import {
  OVERPASS_ENDPOINT,
  POI_MAX_RESULTS,
  POI_MIN_ZOOM,
  POI_QUERY,
} from "@/lib/constants";
import { poiMeta } from "@/lib/poi";

function poiIcon(color) {
  return L.divIcon({
    className: "",
    html: `<div style="width:12px;height:12px;border-radius:9999px;background:${color};border:1.5px solid rgb(var(--bg));box-shadow:0 1px 4px rgb(0 0 0 / 0.35)"></div>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  });
}

function bboxString(bounds) {
  const round = (n) => Number(n.toFixed(5));
  return [
    round(bounds.getSouth()),
    round(bounds.getWest()),
    round(bounds.getNorth()),
    round(bounds.getEast()),
  ].join(",");
}

/**
 * Live POI overlay from the free OpenStreetMap Overpass API.
 * Fetches shops / pharmacies / cafes / banks / etc. for the visible map area
 * (only when zoomed in far enough) and renders them as clustered dots.
 * Debounced + rate-spaced + bbox-deduped to be polite to the public endpoint.
 */
export default function PoiLayer({ onPick, enabled = true }) {
  const map = useMap();
  const [pois, setPois] = useState([]);
  const controllerRef = useRef(null);
  const timerRef = useRef(null);
  const lastBboxRef = useRef(null);
  const lastRequestRef = useRef(0);

  const fetchPois = useCallback(() => {
    if (!enabled || map.getZoom() < POI_MIN_ZOOM) {
      setPois([]);
      return;
    }
    const bbox = bboxString(map.getBounds());
    if (bbox === lastBboxRef.current) return;
    lastBboxRef.current = bbox;

    const wait = Math.max(0, 1200 - (Date.now() - lastRequestRef.current));
    timerRef.current = setTimeout(() => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      lastRequestRef.current = Date.now();

      const query = `[out:json][timeout:8];(${POI_QUERY.map(
        (t) => `node[${t}](${bbox})`
      ).join(";")};${POI_QUERY.map(
        (t) => `way[${t}](${bbox})`
      ).join(";")};);out center ${POI_MAX_RESULTS};`;

      fetch(OVERPASS_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      })
        .then((res) => res.json())
        .then((data) => {
          const elements = Array.isArray(data?.elements) ? data.elements : [];
          setPois(
            elements
              .map((el) => ({
                id: `${el.type}:${el.id}`,
                lat: el.lat ?? el.center?.lat,
                lng: el.lon ?? el.center?.lon,
                name: el.tags?.name ?? "",
                osmKey: el.tags?.shop ? "shop" : el.tags?.amenity ? "amenity" : null,
                osmValue: el.tags?.shop ?? el.tags?.amenity ?? null,
              }))
              .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
          );
        })
        .catch(() => {
          if (!controller.signal.aborted) setPois([]);
        });
    }, wait);
  }, [map, enabled]);

  useMapEvents({
    moveend: fetchPois,
    zoomend: fetchPois,
  });

  useEffect(() => {
    fetchPois();
    return () => {
      clearTimeout(timerRef.current);
      controllerRef.current?.abort();
    };
  }, [fetchPois]);

  return (
    <MarkerClusterGroup
      chunkedLoading
      showCoverageOnHover={false}
      disableClusteringAtZoom={16}
      maxClusterRadius={40}
    >
      {pois.map((poi) => {
        const meta = poiMeta(poi.osmKey, poi.osmValue);
        return (
          <Marker key={poi.id} position={[poi.lat, poi.lng]} icon={poiIcon(meta.color)}>
            <Popup>
              <div className="min-w-[150px]">
                <div className="text-sm font-semibold text-ink">
                  {poi.name || meta.label}
                </div>
                <div className="mt-0.5 text-xs text-ink-dim">{meta.label}</div>
                {onPick && (
                  <button
                    onClick={() =>
                      onPick({
                        lat: poi.lat,
                        lng: poi.lng,
                        address: poi.name || meta.label,
                      })
                    }
                    className="mt-2 w-full rounded-lg bg-accent px-2 py-1.5 text-xs font-medium text-bg transition-colors hover:bg-accent-strong"
                  >
                    Use as target
                  </button>
                )}
              </div>
            </Popup>
          </Marker>
        );
      })}
    </MarkerClusterGroup>
  );
}
