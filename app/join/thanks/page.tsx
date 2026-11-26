import { ButtonLink, Page, PageHeader } from "@/components/ui";

export default function JoinThanksPage() {
  return (
    <Page>
      <PageHeader
        eyebrow="Membership"
        title="Thanks for joining"
        description="Your payment went through. You'll get a receipt by email, and your membership shows on the site within a few minutes."
        actions={
          <>
            <ButtonLink href="/" back variant="secondary">
              Home
            </ButtonLink>
            <ButtonLink href="/standings" variant="primary">
              Standings
            </ButtonLink>
          </>
        }
      />
    </Page>
  );
}
