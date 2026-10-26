import * as Battery from "expo-battery";
import * as Crypto from "expo-crypto";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";

import { LOCATION_TASK } from "../constants";
import { enqueueEvent, enqueuePing } from "./db";
import { flushQueue } from "./queue";

type BackgroundData = {
  locations?: Location.LocationObject[];
  error?: { message?: string };
};

if (!TaskManager.isTaskDefined(LOCATION_TASK)) {
  TaskManager.defineTask<BackgroundData>(LOCATION_TASK, async ({ data, error }) => {
    if (error || !data?.locations?.length) return;

    try {
      const battery = await Battery.getBatteryLevelAsync();
      const batteryPct = battery >= 0 ? Math.round(battery * 100) : null;

      for (const location of data.locations) {
        await enqueuePing({
          client_event_id: Crypto.randomUUID(),
          lat: location.coords.latitude,
          lng: location.coords.longitude,
          accuracy: location.coords.accuracy ?? null,
          speed: location.coords.speed ?? null,
          heading: location.coords.heading ?? null,
          battery_pct: batteryPct,
          provider: "background",
          recorded_at: new Date(location.timestamp).toISOString(),
        });

        if (location.mocked) {
          await enqueueEvent({
            client_event_id: Crypto.randomUUID(),
            type: "fake_gps",
            occurred_at: new Date(location.timestamp).toISOString(),
            meta: {
              lat: location.coords.latitude,
              lng: location.coords.longitude,
              source: "background_location",
            },
          });
        }
      }

      await flushQueue();
    } catch {
      // A failed background pass stays queued for the next wake-up.
    }
  });
}

export function registerBackgroundTask() {
  return LOCATION_TASK;
}
