import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const WORKSPACE_NAME = "Northwind Software";
const DEMO_PASSWORD = "Demo1234!";

const themes = [
  { name: "Onboarding & setup", description: "Getting started, invites, first-run experience.", color: "#6366f1" },
  { name: "Performance & speed", description: "Load times, timeouts, responsiveness.", color: "#ef4444" },
  { name: "Billing & invoicing", description: "Payments, invoices, plan changes.", color: "#f59e0b" },
  { name: "Mobile experience", description: "Phone and tablet usability.", color: "#8b5cf6" },
  { name: "Integrations & API", description: "Third-party connections and developer tooling.", color: "#0ea5e9" },
  { name: "Reporting & exports", description: "Dashboards, downloads, scheduled reports.", color: "#10b981" },
  { name: "Search & filtering", description: "Finding records across the product.", color: "#ec4899" },
  { name: "Support & documentation", description: "Help articles and response quality.", color: "#64748b" },
];

const channels = [
  "Support ticket",
  "App store review",
  "NPS survey",
  "Sales call note",
  "Community post",
  "Live chat",
] as const;

const customers = [
  "Acme Retail", "Bluepeak Health", "Cobalt Logistics", "Dunmore Media", "Everline Bank",
  "Fernwood Labs", "Granite Legal", "Harborview Ltd", "Ironvale Group", "Junipero Foods",
  "Kestrel Energy", "Lumen Studios", "Maribel Travel", "Northgate Tools", "Orchid Systems",
];

/** Grouped by the theme the content naturally belongs to, so clustering has real signal. */
const corpus: { theme: string; recent?: boolean; lines: string[] }[] = [
  {
    theme: "Onboarding & setup",
    lines: [
      "Onboarding took forever. I could not figure out how to invite my team.",
      "The setup wizard skipped straight past the workspace step and I had to start again.",
      "Took us three days to get the whole team in. There is no bulk invite anywhere.",
      "First run experience is confusing. Too many empty screens with no guidance.",
      "I signed up on Monday and still have not managed to import our existing records.",
      "Getting started guide is clear but it does not match the actual screens.",
      "Invite emails went to spam for four of our six people.",
      "Honestly the onboarding is the weakest part. Everything after it is good.",
      "Why do I have to set a workspace name twice during signup?",
      "Our admin could not work out how to assign roles without reading the docs.",
      "The product is great once you are set up. Getting there is the hard bit.",
      "Would love a checklist on first login showing what still needs doing.",
      "Setup was quick for me but our ops team struggled badly.",
      "No way to undo a mistake during setup. Had to create a second account.",
      "The sample data on first login was actually really helpful.",
      "Spent an hour looking for where to add teammates. It is buried in settings.",
      "New starters take about a week to feel comfortable. That is too long.",
      "Please add a proper guided tour. The tooltips are not enough.",
    ],
  },
  {
    theme: "Performance & speed",
    recent: true,
    lines: [
      "The new dashboard is gorgeous and finally fast. Huge improvement.",
      "Page loads have got noticeably slower over the last fortnight.",
      "Every filter change takes four or five seconds to come back.",
      "Timed out twice this morning while loading our main list view.",
      "Speed is the reason we picked you over the competition.",
      "Something changed last week. The app is crawling now.",
      "Loading ten thousand records still spins for ages.",
      "Performance on the list view has become genuinely painful.",
      "It used to be instant. Now I make a cup of tea while it loads.",
      "Three timeouts today alone. Our team is losing confidence.",
      "The export button hangs and then does nothing at all.",
      "Search results appear quickly but the page then freezes for a moment.",
      "Massive slowdown since the update. Please look at this urgently.",
      "Our largest account cannot open their record without a timeout.",
      "Fast, reliable, does what it says. No complaints on speed.",
      "Noticing a lot of spinning wheels this week that were not there before.",
      "The app grinds to a halt once you go past a few thousand rows.",
      "Response times have doubled since the last release.",
      "Still slow after clearing cache and trying a different browser.",
      "Speed regression is our number one issue right now.",
    ],
  },
  {
    theme: "Billing & invoicing",
    recent: true,
    lines: [
      "Billing page keeps timing out when I try to download an invoice.",
      "Charged twice this month and support has not replied yet.",
      "Cannot change our plan without contacting sales. That is frustrating.",
      "Invoices do not show our VAT number so our finance team rejects them.",
      "The upgrade flow failed silently and took the payment anyway.",
      "No way to see past invoices beyond the last six months.",
      "Billing emails go to the account owner only. We need a finance contact.",
      "Pricing page and the in-app plan comparison say different things.",
      "Downgrade removed features immediately instead of at period end.",
      "Please let us pay annually by bank transfer.",
      "Third billing problem this quarter. Considering our options.",
      "Invoice PDF is broken. It downloads a zero byte file.",
      "Card expired and there was no warning until we lost access.",
      "Finance asked me to get a proper receipt and I could not produce one.",
      "The billing section is the only part of the product that feels unfinished.",
      "Getting charged in the wrong currency despite our region setting.",
      "Would happily pay more for a plan that included the reporting add-on.",
      "Refund took eleven days to appear. Communication was poor throughout.",
    ],
  },
  {
    theme: "Mobile experience",
    lines: [
      "It does the job, but the mobile experience needs work.",
      "Tables are unusable on a phone. Everything overflows sideways.",
      "No mobile app, and the website is barely usable on a small screen.",
      "Buttons are too small to tap accurately on my phone.",
      "Works fine on tablet, falls apart on mobile.",
      "I mostly review things on the train and it is a struggle.",
      "The mobile layout has improved a lot recently. Thank you.",
      "Cannot approve anything from my phone which defeats the point.",
      "Text is tiny on mobile and pinch to zoom is disabled.",
      "Please make the navigation collapse properly on small screens.",
      "Half the filters are hidden on mobile with no way to reach them.",
      "Landscape mode on tablet is genuinely good.",
      "Our field team works entirely on phones and cannot use this.",
      "Mobile is an afterthought and it shows.",
      "Would be a five star review if the phone experience matched desktop.",
    ],
  },
  {
    theme: "Integrations & API",
    lines: [
      "Prospect wants SSO before they will sign. Third time this month.",
      "The API rate limits are far too low for our volume.",
      "No webhook for status changes so we poll every minute.",
      "API docs are excellent. Integration took an afternoon.",
      "We need a Salesforce connector or we cannot roll this out company wide.",
      "Authentication tokens expire after an hour with no refresh flow.",
      "Would be perfect with a Slack integration for notifications.",
      "The REST API is clean and predictable. Nice work.",
      "Asked about SSO on the sales call again. It keeps coming up.",
      "No sandbox environment makes testing our integration risky.",
      "Pagination in the API is inconsistent between endpoints.",
      "Zapier support would unblock a lot of smaller teams.",
      "SDK would save us a week of work.",
      "Error responses from the API are not documented anywhere.",
      "Integration broke silently when you changed a field name.",
      "SAML is a hard requirement for their security team.",
    ],
  },
  {
    theme: "Reporting & exports",
    lines: [
      "Love the new export feature, saved me an hour today.",
      "Cannot schedule a report to send weekly. Everything is manual.",
      "CSV export drops the last column every time.",
      "The charts are useful but I cannot change the date range.",
      "Export is limited to a thousand rows which is not enough.",
      "Reporting is the reason we stay. It is genuinely excellent.",
      "Would like to export to Excel rather than CSV.",
      "No way to save a report configuration for next time.",
      "The dashboard numbers do not match what I get when I export.",
      "Please add a print friendly view for the summary page.",
      "Our board pack takes two hours to assemble from your exports.",
      "Charts look great in the product and terrible in a screenshot.",
      "Being able to export filtered results was exactly what we needed.",
      "Reports do not respect the timezone setting.",
    ],
  },
  {
    theme: "Search & filtering",
    lines: [
      "Search only matches the start of a word which is not useful.",
      "Filtering by more than one value at a time is impossible.",
      "The search is fast and accurate. No complaints.",
      "Cannot search inside notes, only titles.",
      "Filters reset every time I navigate away and come back.",
      "Saved searches would transform how our team works.",
      "Typing in the search box lags badly on large accounts.",
      "No way to combine a date range with a status filter.",
      "Search returns results I do not have permission to see.",
      "Advanced search is hidden behind an icon nobody finds.",
      "Really pleased with the filter improvements this month.",
      "Sorting resets to default after every edit.",
      "Would love a way to filter by who last touched a record.",
    ],
  },
  {
    theme: "Support & documentation",
    lines: [
      "Support replied in twenty minutes and solved it. Outstanding.",
      "Docs are out of date. Half the screenshots show an old interface.",
      "Third day waiting on a support ticket with no update.",
      "The help centre search never finds what I am looking for.",
      "Your support team is the best part of the product.",
      "Would be useful to have video walkthroughs for the harder features.",
      "Got passed between three people before anyone could help.",
      "Documentation for the admin features is basically nonexistent.",
      "Chat support is responsive but cannot solve technical issues.",
      "Excellent onboarding call. Our rep knew the product inside out.",
      "Please publish a changelog. We never know what has changed.",
      "Support closed my ticket without resolving it.",
      "The community forum is more useful than the official docs.",
    ],
  },
];

function buildFeedback(workspaceId: string) {
  const rows: {
    content: string;
    channel: string;
    customerLabel: string;
    sourceRef: string;
    createdAt: Date;
    workspaceId: string;
  }[] = [];

  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  let index = 0;

  for (const group of corpus) {
    group.lines.forEach((content, position) => {
      // Recent groups cluster inside the last fortnight so trend spikes are real.
      const daysAgo = group.recent
        ? position % 3 === 0
          ? 15 + ((position * 7) % 70)
          : (position * 3) % 14
        : 4 + ((position * 11) % 86);

      rows.push({
        content,
        channel: channels[index % channels.length],
        customerLabel: customers[index % customers.length],
        sourceRef: `SEED-${String(index + 1).padStart(4, "0")}`,
        createdAt: new Date(now - daysAgo * day - (index % 24) * 60 * 60 * 1000),
        workspaceId,
      });
      index += 1;
    });
  }

  return rows;
}

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  // Idempotent: re-running the seed rebuilds the demo workspace cleanly.
  const previous = await prisma.workspace.findFirst({ where: { name: WORKSPACE_NAME } });
  if (previous) {
    await prisma.workspace.delete({ where: { id: previous.id } });
  }

  const workspace = await prisma.workspace.create({ data: { name: WORKSPACE_NAME } });

  await prisma.user.createMany({
    data: [
      { name: "Priya Admin", email: "admin@loop.demo", passwordHash, role: Role.ADMIN, workspaceId: workspace.id },
      { name: "Alex Analyst", email: "analyst@loop.demo", passwordHash, role: Role.ANALYST, workspaceId: workspace.id },
      { name: "Sam Viewer", email: "viewer@loop.demo", passwordHash, role: Role.VIEWER, workspaceId: workspace.id },
    ],
  });

  await prisma.theme.createMany({
    data: themes.map((theme) => ({ ...theme, workspaceId: workspace.id })),
  });

  const feedback = buildFeedback(workspace.id);
  await prisma.feedback.createMany({ data: feedback });

  console.log(`Seeded "${workspace.name}": 3 users, ${themes.length} themes, ${feedback.length} feedback items.`);
  console.log(`Demo sign-in: admin@loop.demo / analyst@loop.demo / viewer@loop.demo  password: ${DEMO_PASSWORD}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
