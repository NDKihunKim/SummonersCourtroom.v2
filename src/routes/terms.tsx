import { createFileRoute } from "@tanstack/react-router";
import { CONTACT_EMAIL, PolicyPage, Section } from "@/components/PolicyPage";
import { useLocale } from "@/i18n";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Use | Summoner's Courtroom" },
      {
        name: "description",
        content:
          "Usage rules for Summoner's Courtroom, a post-game League of Legends match review tool.",
      },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
  const { locale, setLocale, t } = useLocale();
  if (locale === "ko") {
    return (
      <PolicyPage
        title="이용약관"
        eyebrow="이용 규칙"
        locale={locale}
        onLocaleChange={setLocale}
        t={t}
      >
        <Section title="허용되는 이용">
          <p>
            Summoner's Courtroom은 완료된 League of Legends 경기를 경기 후 리뷰하기 위한
            서비스입니다. 사용자는 공개 Riot 경기 데이터를 검색하고, 경기 기록을 검토하며, 게임이
            끝난 뒤 AI 판결 결과를 확인할 수 있습니다.
          </p>
          <p>
            AI 판결은 경기 복기를 돕는 참고용 분석이며, 항상 완벽하거나 공식적인 판단을 의미하지
            않습니다.
          </p>
        </Section>

        <Section title="금지되는 이용">
          <p>Summoner's Courtroom을 다음 목적으로 사용할 수 없습니다.</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>치팅, 스크립트, 자동화, 또는 실시간 경쟁상 이점 확보.</li>
            <li>라이브 게임 코칭 또는 진행 중인 경기의 숨겨진 정보 제공.</li>
            <li>괴롭힘, 표적 비방, 신상 공개, 또는 독성 행동 조장.</li>
            <li>베팅, 도박, 암호화폐, NFT, 또는 배팅 관련 활동.</li>
            <li>계정 거래, 부스팅, 승부 조작, 또는 유사 서비스.</li>
            <li>숨겨진 MMR, ELO 계산기, 또는 Riot 공식 랭크 시스템의 대체 지표.</li>
            <li>판결 이용 제한, Cloudflare Turnstile, 또는 남용 방지 장치를 우회하려는 행위.</li>
            <li>
              공유 링크를 과도하게 생성하거나 다른 사용자를 괴롭히기 위해 AI 판결을 사용하는 행위.
            </li>
          </ul>
        </Section>

        <Section title="계정, 이용 제한, 공유">
          <p>
            일부 기능은 로그인, 사람 인증, 또는 24시간 기준 이용 제한이 적용될 수 있습니다.
            Summoner's Courtroom은 서비스 안정성, 비용 관리, 남용 방지를 위해 이러한 제한을
            변경하거나 요청을 거부할 수 있습니다.
          </p>
          <p>
            공유 판결 링크는 제한된 시간 동안 제공되며, 링크를 받은 사람이 같은 판결 결과를 볼 수
            있습니다. 공유 기능은 괴롭힘이나 표적 비방 목적으로 사용할 수 없습니다.
          </p>
        </Section>

        <Section title="Riot Games와의 관계">
          <p>
            Summoner's Courtroom은 Riot Games의 보증을 받은 서비스가 아니며, Riot Games 또는 Riot
            Games 자산의 제작 및 운영에 공식적으로 관여하는 사람을 대표하지 않습니다.
          </p>
        </Section>

        <Section title="서비스 이용 가능성">
          <p>
            Riot API 제한, 상위 서비스 오류, 캐시 상태, 배포 변경, 유지보수 등으로 경기 데이터의
            이용 가능성이나 최신성이 영향을 받을 수 있습니다. Summoner's Courtroom은 Riot 정책,
            플랫폼 규칙, 법적 요구사항을 준수하기 위해 기능을 변경, 일시 중단, 또는 제거할 수
            있습니다.
          </p>
        </Section>

        <Section title="문의">
          <p>
            이용약관 관련 문의는{" "}
            <a
              className="font-semibold text-gold underline-offset-4 hover:underline"
              href={`mailto:${CONTACT_EMAIL}`}
            >
              {CONTACT_EMAIL}
            </a>
            로 보내주세요.
          </p>
        </Section>
      </PolicyPage>
    );
  }

  return (
    <PolicyPage
      title="Terms of Use"
      eyebrow="Usage Rules"
      locale={locale}
      onLocaleChange={setLocale}
      t={t}
    >
      <Section title="Permitted use">
        <p>
          Summoner's Courtroom is for post-game review of completed League of Legends matches. You
          may use it to search public Riot match data, review match history, and view AI-assisted
          verdict results after a game has ended.
        </p>
        <p>
          AI verdicts are reference analysis for post-game reflection. They may be imperfect and are
          not official decisions.
        </p>
      </Section>

      <Section title="Prohibited use">
        <p>You may not use Summoner's Courtroom for:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>Cheating, scripts, automation, or live competitive advantage.</li>
          <li>Live-game coaching or game-session-specific hidden information.</li>
          <li>Harassment, targeted abuse, doxxing, or encouraging toxic behavior.</li>
          <li>Betting, gambling, crypto, NFTs, or wagering-related activity.</li>
          <li>Account trading, boosting, win trading, or similar services.</li>
          <li>Hidden MMR, ELO calculators, or alternatives to Riot's official ranked ladder.</li>
          <li>
            Bypassing verdict usage limits, Cloudflare Turnstile, or abuse-prevention systems.
          </li>
          <li>Creating excessive share links or using AI verdicts to harass other users.</li>
        </ul>
      </Section>

      <Section title="Accounts, usage limits, and sharing">
        <p>
          Some features may require sign-in, human verification, or rolling 24-hour usage limits.
          Summoner's Courtroom may change these limits or reject requests to protect reliability,
          manage cost, and prevent abuse.
        </p>
        <p>
          Shared verdict links are available for a limited time and let link recipients view the
          same verdict result. Sharing may not be used for harassment or targeted abuse.
        </p>
      </Section>

      <Section title="Riot Games relationship">
        <p>
          Summoner's Courtroom is not endorsed by Riot Games and does not represent Riot Games or
          anyone officially involved in producing or managing Riot Games properties.
        </p>
      </Section>

      <Section title="Service availability">
        <p>
          Riot API limits, upstream errors, cache state, deployment changes, or maintenance may
          affect availability or freshness of match data. Summoner's Courtroom may change, pause, or
          remove features to comply with Riot policy, platform rules, or legal requirements.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Terms questions can be sent to{" "}
          <a
            className="font-semibold text-gold underline-offset-4 hover:underline"
            href={`mailto:${CONTACT_EMAIL}`}
          >
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </Section>
    </PolicyPage>
  );
}
