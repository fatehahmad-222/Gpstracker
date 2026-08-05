"use client";

import { ThemeProvider } from "./ThemeProvider";
import { AuthProvider } from "./AuthProvider";

export default function RootProviders({ children }) {
  return (
    <ThemeProvider>
      <AuthProvider>{children}</AuthProvider>
    </ThemeProvider>
  );
}
