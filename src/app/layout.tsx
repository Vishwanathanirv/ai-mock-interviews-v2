import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource/jetbrains-mono/400.css";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Rehearse · AI mock interviews", template: "%s · Rehearse" },
  description:
    "Practise job interviews out loud with an adaptive AI interviewer. Get scored on content, depth, structure and delivery, with a detailed report after every session.",
};

export const viewport: Viewport = {
  themeColor: "#111315",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
