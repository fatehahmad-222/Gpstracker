"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { supabase } from "@/lib/supabaseClient";
import { LOCATION_INSERT_MIN_INTERVAL_MS } from "@/lib/constants";

const TrackingContext = createContext({
  status: "idle",
  position: null,
  accuracy: null,
  speed: null,
  heading: null,
  lastUpdate: null,
  error: null,
  retry: () => {},
  supported: false,
});

/**
 * Auto-starts continuous geolocation as soon as an authenticated employee
 * opens the app — there is deliberately no "start broadcasting" button.
 * Every fix is written to `locations` (append-only history); a Postgres
 * trigger keeps live_locations current and auto-completes geofenced tasks.
 */
export function EmployeeTrackerProvider({ children }) {
  const { user } = useAuth();
  const [status, setStatus] = useState("idle");
  const [position, setPosition] = useState(null);
  const [accuracy, setAccuracy] = useState(null);
  const [speed, setSpeed] = useState(null);
  const [heading, setHeading] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [error, setError] = useState(null);
  const watchIdRef = useRef(null);
  const lastInsertRef = useRef(0);

  const supported =
    typeof navigator !== "undefined" && "geolocation" in navigator;

  const stop = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    if (!user || !supported) return;
    setError(null);
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy: acc, speed: sp, heading: hd } = pos.coords;
        setStatus("tracking");
        setPosition({ lat: latitude, lng: longitude });
        setAccuracy(acc ?? null);
        setSpeed(sp ?? null);
        setHeading(hd ?? null);
        setLastUpdate(new Date().toISOString());

        const now = Date.now();
        if (now - lastInsertRef.current >= LOCATION_INSERT_MIN_INTERVAL_MS) {
          lastInsertRef.current = now;
          supabase
            .from("locations")
            .insert({
              employee_id: user.id,
              lat: latitude,
              lng: longitude,
              accuracy: acc ?? null,
              speed: sp ?? null,
              heading: hd ?? null,
            })
            .then(({ error: insertError }) => {
              if (insertError) console.error("Location insert failed:", insertError.message);
            });
        }
      },
      (err) => {
        setError(err?.message ?? "Location unavailable");
        if (err?.code === 1) {
          setStatus("denied");
        } else if (err?.code === 3) {
          setStatus("error");
        } else {
          setStatus("error");
        }
      },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 }
    );
  }, [user, supported]);

  useEffect(() => {
    if (!user) {
      stop();
      setStatus("idle");
      setPosition(null);
      return;
    }
    if (!supported) {
      setStatus("unavailable");
      return;
    }
    start();
    return stop;
  }, [user, supported, start, stop]);

  const retry = useCallback(() => {
    start();
  }, [start]);

  return (
    <TrackingContext.Provider
      value={{ status, position, accuracy, speed, heading, lastUpdate, error, retry, supported }}
    >
      {children}
    </TrackingContext.Provider>
  );
}

export function useTracking() {
  return useContext(TrackingContext);
}
