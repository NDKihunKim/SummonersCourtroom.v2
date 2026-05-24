import { createFileRoute } from "@tanstack/react-router";
import { CONTACT_EMAIL, PolicyPage, Section } from "@/components/PolicyPage";
import { useLocale } from "@/i18n";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy | Summoner's Courtroom" },
      {
        name: "description",
        content:
          "Privacy information for Summoner's Courtroom, including Riot ID searches, cached match data, local browser storage, and future advertising disclosures.",
      },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  const { locale, setLocale, t } = useLocale();
  if (locale === "ko") {
    return (
      <PolicyPage
        title="개인정보 처리방침"
        eyebrow="데이터 처리 방식"
        locale={locale}
        onLocaleChange={setLocale}
        t={t}
      >
        <Section title="사용자가 제공하거나 검색하는 정보">
          <p>
            Riot ID를 검색하면 Summoner's Courtroom은 해당 Riot ID와 선택한 League
            서버 지역을 사용해 Riot API에서 공개 계정 정보와 완료된 경기 데이터를
            요청합니다.
          </p>
          <p>
            검색에는 Riot ID, 서버 지역, 공개 프로필 아이콘, 랭크 요약, 최근 완료된
            경기 기록이 포함될 수 있습니다.
          </p>
        </Section>

        <Section title="Supabase 캐시 경기 데이터">
          <p>
            Summoner's Courtroom은 Supabase를 사용해 검색된 Riot ID의 공개 Riot 경기,
            프로필, 랭크 데이터를 캐시합니다. 이 캐시는 페이지 속도를 개선하고 반복적인
            Riot API 요청을 줄입니다.
          </p>
          <p>
            캐시 데이터에는 게임 이름, 태그라인, PUUID, 서버 지역, 최근 경기 요약,
            공개 챔피언 및 경기 통계, 랭크 티어 정보, 갱신 시간, 집계된 검색 횟수가
            포함될 수 있습니다.
          </p>
        </Section>

        <Section title="로그인과 계정 데이터">
          <p>
            로그인은 Supabase Auth를 통해 처리되며 이메일 매직 링크, Google, Discord
            로그인을 지원합니다. 로그인 과정에서 이메일 주소, 인증 제공자, Supabase
            사용자 ID, 세션 정보가 처리될 수 있습니다.
          </p>
          <p>
            Summoner's Courtroom은 계정별 판결 이용 횟수와 24시간 이용 창의 시작 및
            초기화 시간을 저장해 과도한 사용을 제한합니다.
          </p>
        </Section>

        <Section title="공유 판결 링크">
          <p>
            사용자가 공유 버튼을 누르면 선택된 플레이어, 판결 표시 정보, 판결 이유,
            경기 및 프로필 참조, 언어 설정, 만료 시간이 Supabase에 저장됩니다. 공유
            링크는 72시간 후 만료되며 만료된 공유 데이터는 삭제 대상이 됩니다.
          </p>
        </Section>

        <Section title="로컬 브라우저 저장소">
          <p>
            최근 검색과 저장한 플레이어는 사용자의 기기 브라우저 localStorage에
            저장됩니다. 여기에는 Riot ID, 서버 지역, 저장한 플레이어 표시 정보, 목록
            정렬에 사용되는 시간이 포함됩니다.
          </p>
          <p>
            로컬 브라우저 저장소는 로그인 계정이 아니며 기기 간에 동기화되지 않습니다.
            사이트 UI에서 최근 검색을 삭제하거나 플레이어 저장을 해제할 수 있고,
            브라우저 설정에서도 데이터를 지울 수 있습니다.
          </p>
          <p>
            localStorage에는 익명 판결 이용 횟수 식별자, 언어 설정, 마지막 로그인 방식
            표시 힌트도 저장될 수 있습니다.
          </p>
        </Section>

        <Section title="Cloudflare Turnstile">
          <p>
            검색, 새로고침, AI 판결, 공유 링크 생성 같은 기능의 남용을 줄이기 위해
            Cloudflare Turnstile을 사용할 수 있습니다. Turnstile은 사람이 사용하는지
            확인하기 위해 브라우저와 요청 관련 신호를 Cloudflare에 처리할 수 있습니다.
          </p>
        </Section>

        <Section title="API 키와 서버 비밀 값">
          <p>
            Riot API 키와 Supabase 서비스 역할 키는 서버 측에만 보관됩니다. 해당 키는
            사용자, 브라우저 번들, 소스에서 보이는 프론트엔드 코드, 클라이언트 네트워크
            응답에 의도적으로 노출되지 않습니다.
          </p>
        </Section>

        <Section title="광고와 쿠키">
          <p>
            Summoner's Courtroom은 아직 Google AdSense 코드를 추가하지 않았습니다.
            향후 광고가 추가되면 Google 및 파트너는 광고 제공과 측정을 위해 쿠키,
            웹 비콘, IP 주소 또는 기타 식별자를 사용할 수 있습니다.
          </p>
          <p>
            Google이 파트너 사이트 또는 앱 사용 시 데이터를 사용하는 방식은{" "}
            <a
              href="https://policies.google.com/technologies/partner-sites"
              className="font-semibold text-gold underline-offset-4 hover:underline"
              rel="noreferrer"
              target="_blank"
            >
              Google 파트너 사이트 정책
            </a>
            에서 확인할 수 있습니다.
          </p>
        </Section>

        <Section title="문의">
          <p>
            개인정보 관련 문의는{" "}
            <a className="font-semibold text-gold underline-offset-4 hover:underline" href={`mailto:${CONTACT_EMAIL}`}>
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
      title="Privacy Policy"
      eyebrow="Data Practices"
      locale={locale}
      onLocaleChange={setLocale}
      t={t}
    >
      <Section title="Information you provide or search">
        <p>
          When you search a Riot ID, Summoner's Courtroom uses that Riot ID and
          selected League server region to request public account and completed
          match data from Riot's APIs.
        </p>
        <p>
          Searches may include Riot ID, server region, public profile icon,
          ranked summary, and recent completed match history.
        </p>
      </Section>

      <Section title="Supabase cached match data">
        <p>
          Summoner's Courtroom uses Supabase to cache public Riot match,
          profile, and ranked data for searched Riot IDs. This cache improves
          page speed and reduces repeated Riot API requests.
        </p>
        <p>
          Cached data may include game name, tag line, PUUID, server region,
          recent match summaries, public champion and match statistics, ranked
          tier information, refresh timestamps, and aggregate search counts.
        </p>
      </Section>

      <Section title="Sign-in and account data">
        <p>
          Sign-in is handled by Supabase Auth and may use email magic links,
          Google, or Discord. During sign-in, email address, authentication
          provider, Supabase user id, and session information may be processed.
        </p>
        <p>
          Summoner's Courtroom stores account verdict usage counts and the start
          and reset time of a rolling 24-hour usage window to limit excessive use.
        </p>
      </Section>

      <Section title="Shared verdict links">
        <p>
          When you use the share button, selected players, verdict display
          details, verdict reasoning, match and profile references, locale, and
          expiration time are stored in Supabase. Shared links expire after 72
          hours, and expired shared data is eligible for deletion.
        </p>
      </Section>

      <Section title="Local browser storage">
        <p>
          Recent searches and saved players are stored locally in your browser
          localStorage on your device. This includes Riot ID, server region,
          saved-player display details, and timestamps used to sort the lists.
        </p>
        <p>
          Local browser storage is not a login account and does not sync across
          your devices. You can remove recent searches and unsave players in
          the site UI, or clear the data from your browser settings.
        </p>
        <p>
          localStorage may also store an anonymous verdict usage identifier,
          language preference, and a last-login-method display hint.
        </p>
      </Section>

      <Section title="Cloudflare Turnstile">
        <p>
          Summoner's Courtroom may use Cloudflare Turnstile to reduce abuse of
          search, refresh, AI verdict, and share-link creation features.
          Turnstile may process browser and request signals through Cloudflare to
          verify that requests are made by a human visitor.
        </p>
      </Section>

      <Section title="API keys and server secrets">
        <p>
          Riot API keys and Supabase service role keys are kept server-side
          only. They are not intentionally exposed to users, browser bundles,
          source-visible frontend code, or client network responses.
        </p>
      </Section>

      <Section title="Advertising and cookies">
        <p>
          Summoner's Courtroom does not add Google AdSense code yet. If ads are
          added later, Google and its partners may use cookies, web beacons, IP
          addresses, or other identifiers to serve and measure ads.
        </p>
        <p>
          Learn how Google uses data when you use partner sites or apps at{" "}
          <a
            href="https://policies.google.com/technologies/partner-sites"
            className="font-semibold text-gold underline-offset-4 hover:underline"
            rel="noreferrer"
            target="_blank"
          >
            Google's partner sites policy
          </a>
          .
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Privacy questions can be sent to{" "}
          <a className="font-semibold text-gold underline-offset-4 hover:underline" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </Section>
    </PolicyPage>
  );
}
