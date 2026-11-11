import type { Metadata } from "next";
import { Inter, Playfair_Display } from "next/font/google";
import "./globals.css";

const font = Inter({ subsets: ["latin"] });
const display = Playfair_Display({ subsets: ["latin"], style: ["normal", "italic"], variable: "--font-display" });

export const metadata: Metadata = {
  title: "App Store Screenshots",
  description: "Design and export App Store + Google Play screenshots.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${font.className} ${display.variable}`}>{children}</body>
    </html>
  );
}
