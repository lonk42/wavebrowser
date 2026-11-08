import "./globals.css";
import localFont from "next/font/local";

// Google Fonts' latin subsets, vendored so the build makes no network fetch
// (licences alongside in ./fonts).
const bricolage = localFont({
  variable: "--font-bricolage",
  src: "./fonts/BricolageGrotesque-latin-variable.woff2",
  weight: "600 800",
});

const hanken = localFont({
  variable: "--font-hanken",
  src: "./fonts/HankenGrotesk-latin-variable.woff2",
  weight: "100 900",
});

const plexMono = localFont({
  variable: "--font-plex-mono",
  src: [
    { path: "./fonts/IBMPlexMono-latin-400.woff2", weight: "400" },
    { path: "./fonts/IBMPlexMono-latin-500.woff2", weight: "500" },
    { path: "./fonts/IBMPlexMono-latin-600.woff2", weight: "600" },
  ],
});

export const metadata = {
  title: "WaveBrowser",
  description: "Browse and listen to transcribed radio recordings.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${bricolage.variable} ${hanken.variable} ${plexMono.variable} grain`}
      >
        {children}
      </body>
    </html>
  );
}
