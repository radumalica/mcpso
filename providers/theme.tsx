import * as React from "react";

// No third-party analytics or advertising scripts are loaded. Any future measurement must be first-party,
// privacy-preserving and documented in the privacy notice (see master plan v5, A3).
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
