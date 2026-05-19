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
            Summoner's Courtroom은 완료된 League of Legends 경기를 분석하고,
            플레이어가 경기 후 의사결정을 돌아볼 수 있도록 돕는 서비스입니다.
          </p>
          <p>
            사용자는 Riot ID를 검색해 최근 경기 기록을 확인하고, 공개된 경기 종료
            데이터에 기반한 AI 판결 결과를 볼 수 있습니다.
          </p>
        </Section>

        <Section title="이 제품이 제공하지 않는 것">
          <p>
            Summoner's Courtroom은 실시간 게임 코칭, 라이브 경기 보조, 숨겨진 정보,
            베팅 기능, 부스팅 서비스, 계정 거래, 또는 대체 실력 랭킹 시스템을
            제공하지 않습니다.
          </p>
          <p>
            이 서비스는 경기가 끝난 뒤 복기하기 위한 도구이며, 진행 중인 경기에서
            경쟁상 이점을 만들기 위한 제품이 아닙니다.
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
          Summoner's Courtroom analyzes completed League of Legends matches and
          helps players review post-game decisions.
        </p>
        <p>
          The product lets players search Riot IDs, inspect recent match
          history, and view AI-assisted verdict results based on public
          post-game match data.
        </p>
      </Section>

      <Section title="What this product is not">
        <p>
          Summoner's Courtroom does not provide live-game coaching, real-time
          match assistance, hidden information, betting features, boosting
          services, account trading, or an alternative skill ranking system.
        </p>
        <p>
          The service is intended for reflection after a match has ended, not
          for creating a competitive advantage during a live game.
        </p>
      </Section>
    </PolicyPage>
  );
}
