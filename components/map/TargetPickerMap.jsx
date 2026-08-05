"use client";

import { Circle, MapContainer, Marker, useMapEvents } from "react-leaflet";
import { FlyTo, OsmTiles, geofenceOptions, targetIcon } from "./MapBase";

function ClickCatcher({ onPick }) {
  useMapEvents({
    click: (e) => onPick(e.latlng.lat, e.latlng.lng),
  });
  return null;
}

export default function TargetPickerMap({ target, radius, flyTo, onPick }) {
  return (
    <MapContainer
      center={target ? [target.lat, target.lng] : [31.5497, 74.3436]}
      zoom={target ? 16 : 11}
      scrollWheelZoom
      className="h-64 w-full"
    >
      <OsmTiles />
      <ClickCatcher onPick={onPick} />
      {flyTo && <FlyTo center={[flyTo.lat, flyTo.lng]} zoom={16} />}
      {target && (
        <>
          <Marker position={[target.lat, target.lng]} icon={targetIcon(true)} />
          <Circle
            center={[target.lat, target.lng]}
            radius={radius}
            pathOptions={geofenceOptions()}
          />
        </>
      )}
    </MapContainer>
  );
}
