import { createFileRoute } from "@tanstack/react-router";
import { PolicyPage, Section } from "@/components/PolicyPage";
import { useLocale } from "@/i18n";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About | Summoner's Courtroom" },
      {
        name: "description",
        content:
          "Learn how Summoner's Courtroom helps players review completed League of Legends matches.",
      },
    ],
  }),
  component: AboutPage,
});

function AboutPage() {
  const { locale, setLocale, t } = useLocale();
  if (locale === "ko") {
    return (
      <PolicyPage
        title="Summoner's Courtroom 소개"
        eyebrow="제품 목적"
        locale={locale}
        onLocaleChange={setLocale}
        t={t}
      >
        <Section title="경기 종료 후 리뷰">
          <p>
            Summoner's Courtroom은 완료된 League of Legends 경기를 분석하고, 플레이어가 경기 후
            의사결정을 돌아볼 수 있도록 돕는 서비스입니다.
          </p>
          <p>
            사용자는 Riot ID를 검색해 최근 경기 기록을 확인하고, 공개된 경기 종료 데이터에 기반한 AI
            판결 결과를 볼 수 있습니다.
          </p>
          <p>
            계정 로그인은 이메일 매직 링크, Google, Discord를 통해 지원되며, 로그인한 사용자는
            동일한 브라우저 세션에서 계정 기반 기능을 사용할 수 있습니다.
          </p>
        </Section>

        <Section title="현재 제공되는 기능">
          <p>
            이 서비스는 최근 완료 경기 조회, 랭크 경기 AI 판결, 30분 롤링 기준 판결 이용 횟수 관리,
            저장한 플레이어와 최근 검색, 72시간 동안 유지되는 공유 판결 링크를 제공합니다.
          </p>
          <p>
            AI 판결은 경기 복기를 돕기 위한 분석 결과이며, Riot Games의 공식 판단이나 플레이어 제재
            판단이 아닙니다.
          </p>
        </Section>

        <Section title="이 제품이 제공하지 않는 것">
          <p>
            Summoner's Courtroom은 실시간 게임 코칭, 라이브 경기 보조, 숨겨진 정보, 베팅 기능,
            부스팅 서비스, 계정 거래, 또는 대체 실력 랭킹 시스템을 제공하지 않습니다.
          </p>
          <p>
            이 서비스는 경기가 끝난 뒤 복기하기 위한 도구이며, 진행 중인 경기에서 경쟁상 이점을
            만들기 위한 제품이 아닙니다.
          </p>
        </Section>
      </PolicyPage>
    );
  }

  return (
    <PolicyPage
      title="About Summoner's Courtroom"
      eyebrow="Product Purpose"
      locale={locale}
      onLocaleChange={setLocale}
      t={t}
    >
      <Section title="Post-game match review">
        <p>
          Summoner's Courtroom analyzes completed League of Legends matches and helps players review
          post-game decisions.
        </p>
        <p>
          The product lets players search Riot IDs, inspect recent match history, and view
          AI-assisted verdict results based on public post-game match data.
        </p>
        <p>
          Account sign-in is supported through email magic links, Google, and Discord so signed-in
          users can access account-based features in the same browser session.
        </p>
      </Section>

      <Section title="Current features">
        <p>
          The service currently supports recent completed-match lookup, ranked match AI verdicts,
          rolling verdict usage limits, saved players, recent searches, and shared verdict links
          that expire after 72 hours.
        </p>
        <p>
          AI verdicts are review assistance for post-game reflection. They are not official Riot
          decisions and are not player discipline decisions.
        </p>
      </Section>

      <Section title="What this product is not">
        <p>
          Summoner's Courtroom does not provide live-game coaching, real-time match assistance,
          hidden information, betting features, boosting services, account trading, or an
          alternative skill ranking system.
        </p>
        <p>
          The service is intended for reflection after a match has ended, not for creating a
          competitive advantage during a live game.
        </p>
      </Section>
    </PolicyPage>
  );
}
