import { createFileRoute } from "@tanstack/react-router";
import { CONTACT_EMAIL, PolicyPage, Section } from "@/components/PolicyPage";

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
  return (
    <PolicyPage title="Privacy Policy" eyebrow="Data Practices">
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
