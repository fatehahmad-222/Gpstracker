export type MapPoint = {
  id: string;
  lat: number;
  lng: number;
  name: string;
  subtitle?: string | null;
  tone?: "brand" | "ok" | "warn" | "danger" | "cyan";
  stale?: boolean;
};

export type MapViewProps = {
  points: MapPoint[];
  initialCenter?: { lat: number; lng: number } | null;
  initialZoom?: number;
  showUser?: boolean;
  onSelect?: (point: MapPoint | null) => void;
  emptyLabel?: string;
};
