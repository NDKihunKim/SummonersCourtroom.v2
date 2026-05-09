import { createFileRoute } from "@tanstack/react-router";
import { PolicyLink, PolicyPage, RIOT_DISCLAIMER, Section } from "@/components/PolicyPage";

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
  return (
    <PolicyPage title="Legal" eyebrow="Policies and Disclosures">
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
