import * as Application from "expo-application";
import * as Crypto from "expo-crypto";
import * as Device from "expo-device";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { STORAGE_KEYS } from "./constants";

async function installId() {
  const existing = await SecureStore.getItemAsync(STORAGE_KEYS.installId);
  if (existing) return existing;
  const created = Crypto.randomUUID();
  await SecureStore.setItemAsync(STORAGE_KEYS.installId, created);
  return created;
}

export async function getDeviceId() {
  if (Platform.OS === "android") {
    const androidId = Application.getAndroidId();
    if (androidId) return androidId;
  }
  if (Platform.OS === "ios") {
    const vendorId = await Application.getIosIdForVendorAsync();
    if (vendorId) return vendorId;
  }
  return installId();
}

export async function getDeviceInfo() {
  return {
    model: Device.modelName || Device.deviceName || null,
    manufacturer: Device.manufacturer || null,
    android_version: Platform.OS === "android" ? Device.osVersion : null,
    app_version: Application.nativeApplicationVersion || Application.nativeBuildVersion || null,
    install_id: await installId(),
  };
}

export async function getDeviceLabel() {
  const parts = [Device.manufacturer, Device.modelName].filter(Boolean);
  return parts.length ? parts.join(" ") : `${Platform.OS} device`;
}

export function mobilePlatform(): "ios" | "android" {
  return Platform.OS === "ios" ? "ios" : "android";
}

export function appVersion() {
  return Application.nativeApplicationVersion || "1.0.0";
}
