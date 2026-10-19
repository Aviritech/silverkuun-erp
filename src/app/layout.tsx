import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Silverkuun ERP",
  description: "Departmental workspace for Silverkuun Group",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
