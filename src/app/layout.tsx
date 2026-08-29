import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "SideNote — drug safety case triage",
  description:
    "Training demo. Finds whether a reported reaction is already known for a drug, in the company safety document and the public FDA label, with citations.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      // The inline script below writes data-theme onto this element before
      // React sees it, so the server-rendered markup and the DOM legitimately
      // differ on that one attribute.
      suppressHydrationWarning
    >
      <head>
        {/* Blocking and first, so the page never paints light and then snaps
            to dark. See src/lib/theme.ts for why this is not an effect. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      {/*
        No chrome here. Each route group brings its own: `(public)` a slim
        header for reporters, `(app)` the reviewer rail behind the auth gate.
        One shell for both audiences is what put `Reviewer · Queue · Library`
        in front of a patient filling in a form.
      */}
      <body className="min-h-full bg-paper text-ink">{children}</body>
    </html>
  );
}
