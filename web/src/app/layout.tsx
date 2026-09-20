import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ФИНА — совместный счёт",
  description: "Совместный счёт Ани и Андрея",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru" className="h-full antialiased">
      <body className="flex min-h-full flex-col font-sans">{children}</body>
    </html>
  );
}
