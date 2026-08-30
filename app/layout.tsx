import type { Metadata } from "next";

import "@/app/globals.css";

export const metadata: Metadata = {
  title: "Resolvia — Resolution Workspace",
  description: "Evidence-aware autonomous case resolution workspace.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
