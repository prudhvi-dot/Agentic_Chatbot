import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Agentic Chatbot",
  description: "AI-powered document assistant",
};

export default function RootLayout({
  children,
}: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body className={`${geist.className} min-h-full flex flex-col antialiased`}>
        {children}
      </body>
    </html>
  );
}
