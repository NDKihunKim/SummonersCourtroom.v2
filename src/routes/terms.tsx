import { createFileRoute } from "@tanstack/react-router";
import { CONTACT_EMAIL, PolicyPage, Section } from "@/components/PolicyPage";

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
  return (
    <PolicyPage title="Terms of Use" eyebrow="Usage Rules">
      <Section title="Permitted use">
        <p>
          Summoner's Courtroom is for post-game review of completed League of
          Legends matches. You may use it to search public Riot match data,
          review match history, and view AI-assisted verdict results after a
          game has ended.
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
        </ul>
      </Section>

      <Section title="Riot Games relationship">
        <p>
          Summoner's Courtroom is not endorsed by Riot Games and does not
          represent Riot Games or anyone officially involved in producing or
          managing Riot Games properties.
        </p>
      </Section>

      <Section title="Service availability">
        <p>
          Riot API limits, upstream errors, cache state, deployment changes, or
          maintenance may affect availability or freshness of match data.
          Summoner's Courtroom may change, pause, or remove features to comply
          with Riot policy, platform rules, or legal requirements.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Terms questions can be sent to{" "}
          <a className="font-semibold text-gold underline-offset-4 hover:underline" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </Section>
    </PolicyPage>
  );
}
