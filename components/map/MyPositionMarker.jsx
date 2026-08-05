"use client";

import { Circle, Marker } from "react-leaflet";
import L from "leaflet";

const myPositionIcon = L.divIcon({
  className: "",
  html: `<div class="fleet-pin" style="background:rgb(var(--accent));color:rgb(var(--bg))"><span class="letter">ME</span><span class="ring"></span></div>`,
  iconSize: [38, 38],
  iconAnchor: [19, 19],
});

export default function MyPositionMarker({ position, accuracy }) {
  if (!position) return null;
  return (
    <>
      {accuracy > 0 && (
        <Circle
          center={position}
          radius={accuracy}
          pathOptions={{
            color: "rgb(var(--accent))",
            weight: 1,
            fillColor: "rgb(var(--accent))",
            fillOpacity: 0.08,
          }}
        />
      )}
      <Marker position={position} icon={myPositionIcon} zIndexOffset={1000} />
    </>
  );
}
