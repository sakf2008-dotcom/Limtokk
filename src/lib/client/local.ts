"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";
import { ACCENT_STORAGE_KEY } from "@/lib/domain/accent";

/**
 * Browser-local state (localStorage). Used only for per-device conveniences: preferences, saved
 * items, follows, learning progress, and the ownership tokens this device received. It is not an
 * identity system: clearing browser data removes it, and no server trusts it for anything except
 * the bearer tokens it presents, which the server verifies.
 */

export const LOCAL_KEYS = {
  device: "ilmtok.device.v1",
  prefs: "ilmtok.prefs.v1",
  saved: "ilmtok.saved.v1",
  facts: "ilmtok.facts.v1",
  follows: "ilmtok.follows.v1",
  owned: "ilmtok.owned.v1",
  commentTokens: "ilmtok.commentTokens.v1",
  likes: "ilmtok.likes.v1",
  progress: "ilmtok.progress.v1",
  searches: "ilmtok.searches.v1",
  installHint: "ilmtok.installHint.v1",
  accent: ACCENT_STORAGE_KEY,
} as const;

const CHANGE_EVENT = "ilmtok:local-change";
const DEVICE_PATTERN = /^[A-Za-z0-9_-]{16,80}$/;
let memoryDeviceId: string | null = null;

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function readLocal<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  const raw = safeGet(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeLocal(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be full or blocked (private mode). The app keeps working without it.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Anonymous per-browser identifier. Random, not derived from the device. Sent as a header. */
export function getDeviceId(): string {
  if (memoryDeviceId) return memoryDeviceId;
  const stored = safeGet(LOCAL_KEYS.device);
  if (stored && DEVICE_PATTERN.test(stored)) {
    memoryDeviceId = stored;
    return stored;
  }
  const created = randomId();
  try {
    window.localStorage.setItem(LOCAL_KEYS.device, created);
  } catch {
    // Without storage the id lasts for this page session only.
  }
  memoryDeviceId = created;
  return created;
}

/** Subscribes a component to a localStorage key. Also reacts to changes made in other tabs. */
export function useLocal<T>(key: string, fallbackArg: T): [T, (next: T | ((prev: T) => T)) => void] {
  // Pin the first fallback so inline literals (like `[]`) do not change identity on every render.
  const fallbackRef = useRef(fallbackArg);
  const fallback = fallbackRef.current;
  const cache = useRef<{ raw: string | null; value: T } | null>(null);

  const subscribe = useCallback(
    (onChange: () => void) => {
      const handleStorage = (event: StorageEvent) => {
        if (event.key === null || event.key === key) onChange();
      };
      window.addEventListener("storage", handleStorage);
      window.addEventListener(CHANGE_EVENT, onChange);
      return () => {
        window.removeEventListener("storage", handleStorage);
        window.removeEventListener(CHANGE_EVENT, onChange);
      };
    },
    [key],
  );

  const getSnapshot = useCallback(() => {
    const raw = safeGet(key);
    if (cache.current && cache.current.raw === raw) return cache.current.value;
    let value = fallback;
    if (raw !== null) {
      try {
        value = JSON.parse(raw) as T;
      } catch {
        value = fallback;
      }
    }
    cache.current = { raw, value };
    return value;
  }, [key, fallback]);

  const value = useSyncExternalStore(subscribe, getSnapshot, () => fallback);

  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      const current = readLocal(key, fallback);
      const resolved = typeof next === "function" ? (next as (prev: T) => T)(current) : next;
      writeLocal(key, resolved);
    },
    [key, fallback],
  );

  return [value, setValue];
}
