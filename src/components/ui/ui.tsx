"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useId, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Loader2, X } from "lucide-react";

export function Spinner({ label = "جارٍ التحميل" }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-muted">
      <Loader2 className="spin size-5" aria-hidden="true" />
      <span className="text-sm">{label}</span>
    </span>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded-2xl ${className}`} aria-hidden="true" />;
}

export function EmptyState({
  icon,
  title,
  text,
  action,
}: {
  icon: ReactNode;
  title: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className="fade-in flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="grid size-16 place-items-center rounded-3xl bg-surface-2 text-brand ring-1 ring-white/10">{icon}</div>
      <h2 className="text-lg font-semibold">{title}</h2>
      {text ? <p className="max-w-xs text-sm leading-7 text-muted">{text}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="fade-in flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <div className="grid size-14 place-items-center rounded-3xl bg-danger/15 text-danger">
        <AlertTriangle className="size-6" aria-hidden="true" />
      </div>
      <p className="max-w-sm text-sm leading-7 text-text">{message}</p>
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry}>
          إعادة المحاولة
        </Button>
      ) : null}
    </div>
  );
}

/** Cosmetic avatar in the app's accent color. The initial is the only variation. Never a real photo. */
export function Avatar({ name, size = 40, ring = false }: { avatarKey?: string; name: string; size?: number; ring?: boolean }) {
  const initial = Array.from(name.trim())[0] ?? "•";
  return (
    <span
      aria-hidden="true"
      className={`inline-grid shrink-0 place-items-center rounded-full font-semibold text-ink ${ring ? "ring-2 ring-white" : "ring-1 ring-white/15"}`}
      style={{ width: size, height: size, background: "var(--color-brand)", fontSize: size * 0.42 }}
    >
      {initial}
    </span>
  );
}

export function Chip({
  children,
  href,
  onClick,
  active = false,
  accent,
  small = false,
}: {
  children: ReactNode;
  href?: string;
  onClick?: () => void;
  active?: boolean;
  accent?: string;
  small?: boolean;
}) {
  const className = `inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 ${small ? "h-7 text-xs" : "h-9 text-sm"} font-medium transition-colors ${
    active ? "border-brand bg-brand text-ink" : "border-white/12 bg-white/[0.06] text-text hover:bg-white/10"
  }`;
  const style = accent && !active ? { borderColor: `color-mix(in srgb, ${accent} 45%, transparent)` } : undefined;
  if (href) {
    return (
      <Link href={href} className={className} style={style}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={className} style={style}>
      {children}
    </button>
  );
}

export function Button({
  children,
  variant = "primary",
  type = "button",
  disabled,
  onClick,
  className = "",
  ariaLabel,
  full = false,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  type?: "button" | "submit";
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
  ariaLabel?: string;
  full?: boolean;
}) {
  const styles = {
    primary: "bg-brand text-ink hover:opacity-90",
    secondary: "bg-white/10 text-text hover:bg-white/15 ring-1 ring-white/10",
    ghost: "text-muted hover:text-text hover:bg-white/5",
    danger: "bg-danger/90 text-white hover:bg-danger",
  }[variant];
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      aria-label={ariaLabel}
      className={`inline-flex h-11 items-center justify-center gap-2 rounded-2xl px-5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${full ? "w-full" : ""} ${className}`}
    >
      {children}
    </button>
  );
}

function subscribeNothing(): () => void {
  return () => undefined;
}

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const titleId = useId();
  // Portals need the DOM; this avoids a setState-in-effect just to learn that we are on the client.
  const mounted = useSyncExternalStore(subscribeNothing, () => true, () => false);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open || !mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center">
      <button type="button" aria-label="إغلاق" onClick={onClose} className="fade-in absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="sheet-up relative flex max-h-[88dvh] w-full max-w-lg flex-col rounded-t-[28px] bg-surface-2 ring-1 ring-white/10"
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto mt-2 h-1.5 w-12 rounded-full bg-white/20" aria-hidden="true" />
        <header className="flex items-center justify-between gap-3 px-5 pb-2 pt-3">
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          <button
            type="button"
            aria-label="إغلاق"
            onClick={onClose}
            className="grid size-9 place-items-center rounded-full bg-white/10 hover:bg-white/15"
          >
            <X className="size-[18px]" aria-hidden="true" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>
        {footer ? <div className="border-t border-white/10 px-5 pt-3">{footer}</div> : null}
      </section>
    </div>,
    document.body,
  );
}

type Tone = "default" | "success" | "error";
interface ToastItem {
  id: number;
  message: string;
  tone: Tone;
}

const ToastContext = createContext<{ show: (message: string, tone?: Tone) => void } | null>(null);
let toastCounter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const show = useCallback((message: string, tone: Tone = "default") => {
    toastCounter += 1;
    const id = toastCounter;
    setItems((previous) => [...previous.slice(-2), { id, message, tone }]);
    window.setTimeout(() => setItems((previous) => previous.filter((item) => item.id !== id)), 3200);
  }, []);
  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] z-[80] flex flex-col items-center gap-2 px-4">
        {items.map((item) => (
          <div
            key={item.id}
            className={`fade-in max-w-sm rounded-2xl px-4 py-2.5 text-center text-sm font-medium shadow-xl ring-1 ring-white/10 ${
              item.tone === "error" ? "bg-danger text-white" : item.tone === "success" ? "bg-success text-ink" : "bg-surface-3 text-text"
            }`}
          >
            {item.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside ToastProvider");
  return context;
}
