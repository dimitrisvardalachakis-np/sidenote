import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { DemoBanner } from "@/components/demo-banner";
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
      <body className="flex min-h-full flex-col bg-paper text-ink">
        <DemoBanner />
        <div className="flex flex-1 flex-col">{children}</div>
      </body>
    </html>
  );
}
