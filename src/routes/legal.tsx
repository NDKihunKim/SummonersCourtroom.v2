import { createFileRoute } from "@tanstack/react-router";
import { PolicyLink, PolicyPage, RIOT_DISCLAIMER, Section } from "@/components/PolicyPage";
import { useLocale } from "@/i18n";

export const Route = createFileRoute("/legal")({
  head: () => ({
    meta: [
      { title: "Legal | Summoner's Courtroom" },
      {
        name: "description",
        content:
          "Legal information for Summoner's Courtroom, including privacy, terms, Riot disclaimer, and post-game-only positioning.",
      },
    ],
  }),
  component: LegalPage,
});

function LegalPage() {
  const { locale, setLocale, t } = useLocale();
  if (locale === "ko") {
    return (
      <PolicyPage
        title="법적 고지"
        eyebrow="정책 및 고지"
        locale={locale}
        onLocaleChange={setLocale}
        t={t}
      >
        <Section title="핵심 법적 페이지">
          <p>
            데이터 처리 방식은 <PolicyLink to="/privacy">개인정보 처리방침</PolicyLink>을,
            이용 규칙은 <PolicyLink to="/terms">이용약관</PolicyLink>을 확인해 주세요.
          </p>
        </Section>

        <Section title="경기 종료 후 리뷰 전용">
          <p>
            Summoner's Courtroom은 완료된 League of Legends 경기를 분석하고
            플레이어가 경기 후 의사결정을 복기하도록 돕습니다. 실시간 게임 코칭
            제품이 아니며, 진행 중인 경기의 숨겨진 정보나 경쟁상 이점을 제공하지
            않습니다.
          </p>
        </Section>

        <Section title="Riot Games disclaimer">
          <p className="text-foreground">
            아래 Riot Games 고지는 공식 문구 보존을 위해 영어 원문으로 표시됩니다.
          </p>
          <p>{RIOT_DISCLAIMER}</p>
        </Section>
      </PolicyPage>
    );
  }

  return (
    <PolicyPage
      title="Legal"
      eyebrow="Policies and Disclosures"
      locale={locale}
      onLocaleChange={setLocale}
      t={t}
    >
      <Section title="Core legal pages">
        <p>
          Review the <PolicyLink to="/privacy">Privacy Policy</PolicyLink> for
          data practices and the <PolicyLink to="/terms">Terms of Use</PolicyLink>{" "}
          for usage rules.
        </p>
      </Section>

      <Section title="Post-game-only positioning">
        <p>
          Summoner's Courtroom analyzes completed League of Legends matches and
          helps players review post-game decisions. It is not a live-game
          coaching product and does not provide game-session-specific hidden
          information or competitive advantage.
        </p>
      </Section>

      <Section title="Riot Games disclaimer">
        <p>{RIOT_DISCLAIMER}</p>
      </Section>
    </PolicyPage>
  );
}
