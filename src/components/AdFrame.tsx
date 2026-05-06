import type { ReactNode } from "react";

/**
 * Mock ad slots (north/south leaderboards + east/west skyscrapers) have
 * been removed per product decision. AdFrame now just provides the
 * page-level wrapper so existing call sites keep working without any
 * layout shift around the content column.
 */

export function AdFrame({
  children,
  fitViewport = false,
}: {
  children: ReactNode;
  /**
   * When true, the frame is locked to viewport height (no page scroll)
   * and the content column absorbs all available space. Leave false for
   * pages that legitimately need to scroll (e.g. match history list).
   */
  fitViewport?: boolean;
}) {
  const outer = fitViewport
    ? "flex h-screen flex-col overflow-hidden"
    : "min-h-screen";
  const contentCol = fitViewport
    ? "min-w-0 min-h-0 flex-1 h-full px-3 py-3"
    : "min-w-0 flex-1 px-3 py-3";

  return (
    <div className={outer}>
      <div className={contentCol}>{children}</div>
    </div>
  );
}