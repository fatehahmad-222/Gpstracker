function clean(value: string | undefined) {
  return value?.trim() || "";
}

export const env = {
  supabaseUrl: clean(process.env.EXPO_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: clean(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY),
  apiUrl: clean(process.env.EXPO_PUBLIC_API_URL).replace(/\/+$/, ""),
  easProjectId: clean(process.env.EXPO_PUBLIC_EAS_PROJECT_ID),
  mapStyleUrl: clean(process.env.EXPO_PUBLIC_MAP_STYLE_URL),
  privacyUrl: clean(process.env.EXPO_PUBLIC_PRIVACY_URL),
};

export const missingConfig = [
  !env.supabaseUrl ? "EXPO_PUBLIC_SUPABASE_URL" : null,
  !env.supabaseAnonKey ? "EXPO_PUBLIC_SUPABASE_ANON_KEY" : null,
  !env.apiUrl ? "EXPO_PUBLIC_API_URL" : null,
].filter(Boolean) as string[];

export const isConfigured = missingConfig.length === 0;
