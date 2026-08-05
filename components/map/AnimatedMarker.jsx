"use client";

import { useEffect, useRef } from "react";
import { Marker } from "react-leaflet";
import L from "leaflet";

/**
 * Marker whose position glides toward its target rather than jumping.
 * Interpolates over ~900ms with an ease-out curve using setLatLng.
 */
export default function AnimatedMarker({ position, icon, children, ...rest }) {
  const markerRef = useRef(null);
  const fromRef = useRef(null);

  useEffect(() => {
    const marker = markerRef.current;
    if (!marker) return;

    const to = L.latLng(position[0], position[1]);
    const from = fromRef.current;

    if (!from) {
      marker.setLatLng(to);
      fromRef.current = to;
      return;
    }

    if (from.distanceTo(to) < 1) {
      fromRef.current = to;
      return;
    }

    const start = performance.now();
    const duration = 900;
    let raf;

    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const lat = from.lat + (to.lat - from.lat) * eased;
      const lng = from.lng + (to.lng - from.lng) * eased;
      marker.setLatLng([lat, lng]);
      if (t < 1) {
        raf = requestAnimationFrame(step);
      } else {
        fromRef.current = to;
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [position]);

  return (
    <Marker ref={markerRef} position={position} icon={icon} {...rest}>
      {children}
    </Marker>
  );
}
