/**
 * Simulated channel integrations.
 *
 * Stands in for the connectors LOOP would really have. Pressing a button drops a
 * believable batch of feedback into the workspace so a demo can show data
 * arriving, and so the inbox is never empty on a fresh install. The channel names
 * match the ones the rest of the product uses, so simulated rows filter and group
 * alongside everything else.
 */

export type SimulatedSource = {
  id: string;
  label: string;
  description: string;
  channel: string;
  customers: string[];
  lines: string[];
};

export const SIMULATED_SOURCES: SimulatedSource[] = [
  {
    id: "helpdesk",
    label: "Helpdesk",
    description: "Recent support tickets.",
    channel: "Support ticket",
    customers: ["Acme Retail", "Cobalt Logistics", "Everline Bank", "Harborview Ltd", "Orchid Systems"],
    lines: [
      "The weekly export has failed three days running and nobody has told us why.",
      "Two of our users cannot reset their password. The email never arrives.",
      "Bulk edit silently drops the last row of any selection over fifty records.",
      "Our admin lost access after the plan change and we had to raise a ticket to get it back.",
      "Attachments over ten megabytes fail with a generic error rather than a size warning.",
      "Saved filters vanish whenever we sign out. It is costing the team real time.",
      "Sorting by date puts blank dates first, which buries everything that matters.",
      "The API returned 500s for about twenty minutes this morning and then recovered.",
      "Duplicate records appear whenever two people edit the same account at once.",
      "Support got back to us in under an hour and had it fixed the same day. Excellent.",
      "We cannot deactivate a user without deleting their history, which we need to keep.",
      "The timezone on scheduled reports is wrong for everyone outside London.",
    ],
  },
  {
    id: "app-store",
    label: "App Store",
    description: "New mobile reviews.",
    channel: "App store review",
    customers: [],
    lines: [
      "Logs me out every single morning. Fingerprint sign-in would fix this instantly.",
      "Great on desktop, painful on a phone. The tables do not fit the screen at all.",
      "Latest update fixed the crash on launch. Back to five stars from me.",
      "No offline mode, so it is useless on the train, which is when I actually need it.",
      "Push notifications arrive hours late if they arrive at all.",
      "Clean design and genuinely quick. Does what I need between meetings.",
      "Crashes whenever I open a record with more than a few attachments.",
      "The tablet layout is just the phone one stretched. Please make proper use of the space.",
      "Search on mobile only looks at titles, not the actual content.",
      "Battery drain is noticeable if I leave it running in the background.",
    ],
  },
  {
    id: "nps",
    label: "NPS survey",
    description: "Latest survey responses.",
    channel: "NPS survey",
    customers: ["Bluepeak Health", "Dunmore Media", "Fernwood Labs", "Kestrel Energy", "Northgate Tools"],
    lines: [
      "Would recommend without hesitation. It replaced three tools for us.",
      "Good product held back by reporting. We still export to a spreadsheet every week.",
      "Setting it up took far longer than we were told it would.",
      "Reliable and fast. We have had no outages that affected us this quarter.",
      "Pricing jumped at renewal with no warning and no explanation.",
      "The team likes it. Our finance department does not, because of the invoicing.",
      "Everything works, nothing delights. It is fine.",
      "Support is the best part. The product is catching up to them.",
      "Too many clicks to do the one thing I do twenty times a day.",
      "Best decision we made last year. The whole team is on it now.",
    ],
  },
];

export const SIMULATED_SOURCE_IDS = SIMULATED_SOURCES.map((source) => source.id);

export type SimulatedRow = {
  content: string;
  channel: string;
  customerLabel: string | null;
  sourceRef: string;
  createdAt: Date;
};

const HOUR = 60 * 60 * 1000;

/**
 * Picks `count` distinct lines and spreads them over the last few days, so a
 * simulated batch looks like a real feed rather than a block of identical
 * timestamps. If `count` exceeds the corpus the lines wrap around.
 */
export function buildSimulatedBatch(source: SimulatedSource, count: number): SimulatedRow[] {
  const shuffled = [...source.lines];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const now = Date.now();

  return Array.from({ length: count }, (_, index) => {
    const content = shuffled[index % shuffled.length];
    const customers = source.customers;

    return {
      content,
      channel: source.channel,
      customerLabel: customers.length > 0 ? customers[Math.floor(Math.random() * customers.length)] : null,
      // Spread backwards over roughly the last three days.
      createdAt: new Date(now - Math.floor(Math.random() * 72) * HOUR - index * 7 * 60 * 1000),
      sourceRef: `SIM-${source.id.toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    };
  });
}
