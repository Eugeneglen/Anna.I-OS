import type { Metadata, Viewport } from "next";
import { Manrope, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "sonner";
import { QueryProvider } from "@/components/query-provider";
import { ThemeProvider } from "@/components/theme-provider";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Anna.I — The Operating System for the Modern Household",
  description:
    "Subscription-based AI operating system for Singapore households. Automate cleaning, laundry, aircon servicing, and handyman tasks.",
  keywords: [
    "Anna.I",
    "household management",
    "Singapore",
    "AI",
    "home services",
  ],
  icons: {
    icon: "/favicon.ico",
  },
  openGraph: {
    title: "Anna.I — Household Operating System",
    description: "AI-powered household management for Singapore homes",
    type: "website",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Anna.I",
  },
};

// viewport-fit=cover activates env(safe-area-inset-*) on notched iOS devices
// (required by the .safe-area-inset-bottom bottom-nav padding).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Blocking theme script — prevents FOUC (flash of light theme before dark mode applies) */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                var t = localStorage.getItem('theme');
                if (t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                  document.documentElement.classList.add('dark');
                }
              } catch (e) {}
            `,
          }}
        />
      </head>
      <body
        className={`${manrope.variable} ${jetbrainsMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          <QueryProvider>{children}</QueryProvider>
          <Toaster />
          <SonnerToaster position="top-center" richColors closeButton duration={3000} toastOptions={{ style: { fontFamily: 'var(--font-manrope), system-ui, sans-serif' } }} />
        </ThemeProvider>
      </body>
    </html>
  );
}