"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bookmark, Compass, House, MoreHorizontal, Plus, type LucideIcon } from "lucide-react";

interface Tab {
  href: string;
  label: string;
  icon: LucideIcon;
  primary?: boolean;
}

/** The five tabs, in the order required by the product: first tab on the right (RTL). */
export const TABS: Tab[] = [
  { href: "/", label: "الرئيسية", icon: House },
  { href: "/explore", label: "استكشف", icon: Compass },
  { href: "/add", label: "إضافة", icon: Plus, primary: true },
  { href: "/saved", label: "المحفوظات", icon: Bookmark },
  { href: "/more", label: "المزيد", icon: MoreHorizontal },
];

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="التنقل الرئيسي" className="fixed inset-x-0 bottom-0 z-40" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      <ul className="mx-auto flex h-16 max-w-lg items-center justify-around border-t border-white/[0.07] bg-ink/92 backdrop-blur-xl">
        {TABS.map((tab) => {
          const active = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
          const Icon = tab.icon;
          if (tab.primary) {
            return (
              <li key={tab.href}>
                <Link
                  href={tab.href}
                  aria-label={tab.label}
                  className="grid h-10 w-14 place-items-center rounded-2xl bg-gradient-to-br from-brand to-teal text-ink shadow-[0_0_0_1px_rgba(255,255,255,0.12)] active:scale-95"
                >
                  <Icon className="size-6" strokeWidth={2.6} aria-hidden="true" />
                </Link>
              </li>
            );
          }
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`mx-auto flex min-w-14 flex-col items-center gap-0.5 py-1.5 text-[11px] font-medium transition-colors ${
                  active ? "text-brand" : "text-muted hover:text-text"
                }`}
              >
                <Icon className="size-[22px]" strokeWidth={active ? 2.4 : 2} aria-hidden="true" />
                <span>{tab.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
