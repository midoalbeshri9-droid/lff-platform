import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "منظومة اللجان — الاتحاد الليبي لكرة القدم", template: "%s — الاتحاد الليبي لكرة القدم" },
  description: "منظومة القيد وأوضاع اللاعبين والمسابقات والحكام — الاتحاد الليبي لكرة القدم",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
