import { createFileRoute } from "@tanstack/react-router";
import { CONTACT_EMAIL, PolicyPage, Section } from "@/components/PolicyPage";
import { useLocale } from "@/i18n";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "Contact | Summoner's Courtroom" },
      {
        name: "description",
        content: "Contact Summoner's Courtroom for support, privacy, or policy questions.",
      },
    ],
  }),
  component: ContactPage,
});

function ContactPage() {
  const { locale, setLocale, t } = useLocale();
  if (locale === "ko") {
    return (
      <PolicyPage title="문의" eyebrow="지원" locale={locale} onLocaleChange={setLocale} t={t}>
        <Section title="공개 지원 연락처">
          <p>
            지원, 개인정보, 정책, 제품 관련 문의는{" "}
            <a
              className="font-semibold text-gold underline-offset-4 hover:underline"
              href={`mailto:${CONTACT_EMAIL}`}
            >
              {CONTACT_EMAIL}
            </a>
            로 보내주세요.
          </p>
          <p>
            로그인 문제, 데이터 삭제 요청, 공유 판결 신고, AI 판결 또는 이용 제한 관련 질문도 같은
            주소로 문의할 수 있습니다.
          </p>
        </Section>

        <Section title="개발자 및 플랫폼 고지">
          <p>
            Riot Games는 Riot Developer Portal을 통해 프로젝트 소유자에게 연락할 수 있습니다. 이
            공개 연락처 페이지는 사용자, 심사자, 플랫폼 파트너가 확인할 수 있는 책임 있는 연락
            채널을 제공하기 위해 존재합니다.
          </p>
        </Section>
      </PolicyPage>
    );
  }

  return (
    <PolicyPage title="Contact" eyebrow="Support" locale={locale} onLocaleChange={setLocale} t={t}>
      <Section title="Public support contact">
        <p>
          For support, privacy, policy, or product questions, email{" "}
          <a
            className="font-semibold text-gold underline-offset-4 hover:underline"
            href={`mailto:${CONTACT_EMAIL}`}
          >
            {CONTACT_EMAIL}
          </a>
          .
        </p>
        <p>
          You can also use this address for login issues, data deletion requests, shared verdict
          reports, AI verdict questions, or usage-limit questions.
        </p>
      </Section>

      <Section title="Developer and platform notices">
        <p>
          Riot Games may also contact the project owner through the Riot Developer Portal. This
          public contact page exists so users, reviewers, and platform partners have a visible
          accountability channel.
        </p>
      </Section>
    </PolicyPage>
  );
}
