import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "My AI Chatbot",
  description: "A free AI chatbot built with Next.js and Groq",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
