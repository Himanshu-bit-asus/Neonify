import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/auth-provider";
import { PlayerProvider } from "@/components/player-provider";
import { QueryProvider } from "@/components/query-provider";

export const metadata: Metadata = {
  title: "Streamify — Listen without limits",
  description: "A premium music streaming experience.",
  manifest: "/manifest.json",
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#bef264",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <link rel="manifest" href="/manifest.json" />
      </head>
      <body>
        <AuthProvider>
          <QueryProvider>
            <PlayerProvider>{children}</PlayerProvider>
          </QueryProvider>
        </AuthProvider>
        <script
          dangerouslySetInnerHTML={{
            __html: process.env.NODE_ENV === "development"
              ? `
                  if ('serviceWorker' in navigator && (location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
                    navigator.serviceWorker.getRegistrations().then((registrations) => registrations.forEach((registration) => registration.unregister()));
                    caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('streamify-shell-')).map((key) => caches.delete(key))));
                  }
                `
              : `
                  if ('serviceWorker' in navigator) {
                    window.addEventListener('load', () => {
                      navigator.serviceWorker.register('/sw.js').catch(() => {});
                    });
                  }
                `,
          }}
        />
      </body>
    </html>
  );
}
