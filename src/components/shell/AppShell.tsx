"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { BottomNav } from "@/components/nav/BottomNav";
import { ToastProvider } from "@/components/ui/ui";

/** Global client wrapper: toasts, bottom navigation (hidden on full-screen flows), offline support. */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const hideNav = pathname === "/add" || pathname.startsWith("/admin") || pathname === "/offline";

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  }, []);

  return (
    <ToastProvider>
      {children}
      {hideNav ? null : <BottomNav />}
    </ToastProvider>
  );
}
