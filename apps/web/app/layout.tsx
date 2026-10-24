import type { ReactNode } from "react";
import { Shell } from "./components/Shell";
import "./globals.css";

export const metadata = {
  title: process.env.NEXT_PUBLIC_APP_NAME ?? "AfterHours",
  description: "Work that is prepared while you are away, ready for your review.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body><Shell>{children}</Shell></body>
    </html>
  );
}
