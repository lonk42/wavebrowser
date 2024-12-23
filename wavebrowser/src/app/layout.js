import 'bootstrap/dist/css/bootstrap.css';
import "./globals.css";
import { Geist, Geist_Mono } from "next/font/google";
import BootstrapClient from '@/components/BootstrapClient.js';

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "WaveBrowser",
  description: "Browse recorded radio snippets.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
				<BootstrapClient />
      </body>
    </html>
  );
}
