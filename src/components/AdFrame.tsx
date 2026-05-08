import type { ReactNode } from "react";

const RIOT_DISCLAIMER =
  "Summoner's Courtroom isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.";

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
  const outer = fitViewport ? "flex min-h-screen flex-col" : "min-h-screen";
  const contentCol = fitViewport ? "min-w-0 min-h-0 flex-1 px-3 py-3" : "min-w-0 flex-1 px-3 py-3";

  return (
    <div className={outer}>
      <a
        href="/"
        aria-label="Go to Summoner's Courtroom home"
        className="fixed left-3 top-3 z-50 inline-flex h-12 w-12 items-center justify-center rounded-md border border-gold/30 bg-background/70 p-1.5 shadow-lg backdrop-blur transition hover:border-gold hover:bg-card"
      >
        <img
          src="/summoners-courtroom-logo.png"
          alt=""
          className="h-full w-full object-contain"
          aria-hidden="true"
        />
      </a>
      <div className={contentCol}>{children}</div>
      <footer className="shrink-0 px-4 pb-3 text-center text-[10px] leading-relaxed text-muted-foreground/80">
        {RIOT_DISCLAIMER}
      </footer>
    </div>
  );
}
