import type { Metadata, Viewport } from "next";
import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/500.css";
import "@fontsource/ibm-plex-sans-arabic/600.css";
import "@fontsource/ibm-plex-sans-arabic/700.css";
import "./globals.css";
import { AppShell } from "@/components/shell/AppShell";
import { accentBootScript } from "@/lib/domain/accent";
import { siteUrl } from "@/lib/domain/site";
import splashScreens from "@/lib/domain/splash-screens.json";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: "علم توك | IlmTok — اسحب وتعلّم",
    template: "%s · علم توك",
  },
  description: "منصة فيديوهات تعليمية قصيرة عربية. شاهد واكتشف وتعلّم دون تسجيل حساب.",
  applicationName: "علم توك",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "علم توك",
    statusBarStyle: "black-translucent",
    // Launch screens for the home-screen app on iPhone. Each one matches a device size exactly.
    startupImage: splashScreens.map((screen) => ({
      url: `/splash/apple-splash-${screen.cssWidth}x${screen.cssHeight}@${screen.scale}x.png`,
      media: `(device-width: ${screen.cssWidth}px) and (device-height: ${screen.cssHeight}px) and (-webkit-device-pixel-ratio: ${screen.scale}) and (orientation: portrait)`,
    })),
  },
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: "#07080c",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body className="min-h-dvh bg-ink text-text antialiased">
        <script dangerouslySetInnerHTML={{ __html: accentBootScript() }} />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
