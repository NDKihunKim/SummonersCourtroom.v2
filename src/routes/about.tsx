import { createFileRoute } from "@tanstack/react-router";
import { PolicyPage, Section } from "@/components/PolicyPage";

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
  return (
    <PolicyPage title="About Summoner's Courtroom" eyebrow="Product Purpose">
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
