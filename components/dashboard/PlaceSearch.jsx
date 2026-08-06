"use client";

import { useRef, useState } from "react";
import { Loader2, MapPin, Search } from "lucide-react";
import { PHOTON_ENDPOINT } from "@/lib/constants";
import { poiMeta } from "@/lib/poi";

const TYPE_LABELS = {
  house: "Address",
  street: "Street",
  locality: "Place",
  city: "City",
  district: "District",
  historic: "Historic place",
  tourism: "Tourist place",
  leisure: "Leisure",
  natural: "Natural feature",
};

function typeLabel(props) {
  if (props.osm_key === "shop" || props.osm_key === "amenity") {
    return poiMeta(props.osm_key, props.osm_value).label;
  }
  return (
    TYPE_LABELS[props.type] ??
    TYPE_LABELS[props.osm_key] ??
    (props.osm_value ? props.osm_value.replace(/_/g, " ") : props.type ?? "Place")
  );
}

function displayName(props) {
  const parts = [];
  if (props.name) parts.push(props.name);
  if (props.street) {
    parts.push(props.housenumber ? `${props.housenumber} ${props.street}` : props.street);
  } else if (props.district) {
    parts.push(props.district);
  }
  if (props.city) parts.push(props.city);
  if (props.state && props.state !== props.city) parts.push(props.state);
  if (props.country) parts.push(props.country);
  return parts.join(", ") || props.name || "Location";
}

/**
 * Client-side Photon (OpenStreetMap) place search. Photon indexes OSM POIs by
 * name (shops, pharmacies, stores…) and returns building-level coordinates,
 * which makes pinning the target land on the exact place. Debounced + capped
 * to stay polite to the free public API.
 */
export default function PlaceSearch({ onPick, placeholder, className }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const timerRef = useRef(null);

  async function runSearch(q) {
    if (!q || q.trim().length < 3) {
      setResults([]);
      setOpen(false);
      return;
    }
    setSearching(true);
    try {
      const url = `${PHOTON_ENDPOINT}/?q=${encodeURIComponent(
        q.trim()
      )}&limit=5&lang=en`;
      const res = await fetch(url, {
        headers: { accept: "application/json" },
      });
      const data = await res.json();
      const features = Array.isArray(data?.features) ? data.features : [];
      setResults(
        features.map((f) => ({
          lat: f.geometry.coordinates[1],
          lng: f.geometry.coordinates[0],
          name: f.properties?.name ?? "",
          address: displayName(f.properties ?? {}),
          type: typeLabel(f.properties ?? {}),
          osmKey: f.properties?.osm_key,
          osmValue: f.properties?.osm_value,
        }))
      );
      setOpen(true);
    } catch {
      setResults([]);
      setOpen(false);
    } finally {
      setSearching(false);
    }
  }

  function handleChange(e) {
    const q = e.target.value;
    setQuery(q);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => runSearch(q), 600);
  }

  function pick(result) {
    onPick({
      lat: result.lat,
      lng: result.lng,
      address: result.address,
    });
    setOpen(false);
  }

  return (
    <div className={`relative ${className ?? ""}`}>
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-dim" />
        <input
          value={query}
          onChange={handleChange}
          placeholder={placeholder ?? "Search a shop, pharmacy, address…"}
          className="w-full rounded-field border border-line bg-bg py-2.5 pl-9 pr-9 text-sm text-ink placeholder:text-ink-dim/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
        />
        {searching && (
          <Loader2 size={15} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-ink-dim" />
        )}
      </div>

      {open && results.length > 0 && (
        <div className="absolute z-30 mt-1.5 max-h-72 w-full overflow-y-auto rounded-field border border-line bg-surface shadow-pop">
          {results.map((r, i) => (
            <button
              key={`${r.lat}-${r.lng}-${i}`}
              onClick={() => pick(r)}
              className="flex w-full items-start gap-2.5 border-b border-line px-3 py-2.5 text-left transition-colors last:border-0 hover:bg-surface-2"
            >
              <MapPin size={14} className="mt-0.5 shrink-0 text-accent" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-ink">{r.address}</span>
                <span className="mt-0.5 block text-[11px] font-medium uppercase tracking-wide text-ink-dim">
                  {r.type}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      {open && results.length === 0 && !searching && (
        <div className="absolute z-20 mt-1.5 w-full rounded-field border border-line bg-surface px-3 py-2.5 text-sm text-ink-dim shadow-pop">
          No results found.
        </div>
      )}
    </div>
  );
}
