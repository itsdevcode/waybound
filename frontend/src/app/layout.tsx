import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WAYBOUND — AI-Powered Real-World Mystery Quests",
  description:
    "An AI adventure companion that transforms nearby real-world places into immersive RPG quests with Google Places and Gemma AI.",
  keywords: ["rpg", "outdoor exploration", "gps game", "gemma ai", "google places", "adventure"],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#090812",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="bg-rpg-stars min-h-screen text-slate-100 antialiased selection:bg-purple-600 selection:text-white">
        <div className="relative min-h-screen flex flex-col justify-between">
          {children}
        </div>
      </body>
    </html>
  );
}
