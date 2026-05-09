import { createFileRoute } from "@tanstack/react-router";
import { CONTACT_EMAIL, PolicyPage, Section } from "@/components/PolicyPage";

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
  return (
    <PolicyPage title="Contact" eyebrow="Support">
      <Section title="Public support contact">
        <p>
          For support, privacy, policy, or product questions, email{" "}
          <a className="font-semibold text-gold underline-offset-4 hover:underline" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
          .
        </p>
        <p>
          This is a placeholder public contact address and should be replaced
          with a real production inbox before launch.
        </p>
      </Section>

      <Section title="Developer and platform notices">
        <p>
          Riot Games may also contact the project owner through the Riot
          Developer Portal. This public contact page exists so users, reviewers,
          and platform partners have a visible accountability channel.
        </p>
      </Section>
    </PolicyPage>
  );
}
