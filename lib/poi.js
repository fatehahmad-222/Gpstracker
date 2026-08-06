export const POI_CATEGORY_META = {
  pharmacy: { label: "Pharmacy", color: "#38bdf8" },
  clinic: { label: "Clinic", color: "#f43f5e" },
  hospital: { label: "Hospital", color: "#f43f5e" },
  restaurant: { label: "Restaurant", color: "#f59e0b" },
  fast_food: { label: "Fast food", color: "#f59e0b" },
  cafe: { label: "Café", color: "#a78bfa" },
  bank: { label: "Bank", color: "#10b981" },
  atm: { label: "ATM", color: "#10b981" },
  fuel: { label: "Fuel station", color: "#ef4444" },
  supermarket: { label: "Supermarket", color: "#3b82f6" },
  marketplace: { label: "Marketplace", color: "#3b82f6" },
  school: { label: "School", color: "#f472b6" },
  parking: { label: "Parking", color: "#94a3b8" },
  shop: { label: "Shop", color: "#3b82f6" },
};

export const DEFAULT_POI_COLOR = "#64748b";

/** Resolves category meta for an OSM tag pair (e.g. amenity=pharmacy). */
export function poiMeta(osmKey, osmValue) {
  return (
    POI_CATEGORY_META[osmValue] ??
    POI_CATEGORY_META[osmKey] ?? {
      label: osmValue ? osmValue.replace(/_/g, " ") : "Place",
      color: DEFAULT_POI_COLOR,
    }
  );
}
