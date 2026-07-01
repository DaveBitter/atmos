import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Atmos — a live pulse of the planet",
  description: "A live, playful weather visualization of cities around the world, powered by Open-Meteo.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full overflow-hidden antialiased">
      <body className="h-full overflow-hidden flex flex-col font-sans">{children}</body>
    </html>
  );
}
