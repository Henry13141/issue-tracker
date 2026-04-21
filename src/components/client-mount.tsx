"use client";

import { useState, useEffect, startTransition, type ReactNode } from "react";

/**
 * Defers rendering `children` until after React hydration completes.
 * During SSR, renders the `fallback` (defaults to a blank placeholder).
 *
 * This prevents hydration mismatches caused by browser tools that inject
 * attributes (e.g. data-cursor-ref) into the DOM before React hydrates.
 */
export function ClientMount({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    startTransition(() => setMounted(true));
  }, []);

  if (!mounted) {
    return fallback ?? <div className="min-h-screen" />;
  }

  return <>{children}</>;
}
