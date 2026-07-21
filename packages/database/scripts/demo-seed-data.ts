/**
 * Realistic demo workspace data — seeded into Postgres (mail cache + queue).
 * Same paths as production: Brief gather, Agent list_inbox/get_thread, Inbox UI.
 */

export type DemoMailFixture = {
  threadId: string;
  subject: string;
  fromName: string;
  fromAddress: string;
  /** Full message body stored in mail cache snippet column. */
  body: string;
  unread: boolean;
  hoursAgo: number;
  starred?: boolean;
};

export type DemoQueueFixture = {
  kind: "email_send" | "email_draft" | "calendar_invite";
  title: string;
  preview: string;
  payload: Record<string, unknown>;
  status: "pending" | "approved" | "dismissed";
};

export const DEMO_MAIL_FIXTURES: DemoMailFixture[] = [
  {
    threadId: "demo-thread-investor",
    subject: "Re: Series A term sheet — need your input by EOD Friday",
    fromName: "Sarah Chen",
    fromAddress: "sarah@venture.co",
    body: `Hi,

Following up on our term sheet discussion from Tuesday's call.

We need your confirmation on three items before legal can finalize:
1. Valuation cap at $12M
2. Pro-rata rights for existing investors
3. Board observer seat for Horizon Ventures

Can you reply before EOD Friday? If easier, I can jump on a 15-minute call tomorrow morning.

Best,
Sarah Chen
Partner, Horizon Ventures`,
    unread: true,
    hoursAgo: 2,
    starred: true,
  },
  {
    threadId: "demo-thread-vendor-invoice",
    subject: "Invoice #8842 — payment due March 28",
    fromName: "Accounts Payable",
    fromAddress: "billing@cloudstack.io",
    body: `Hello,

Invoice #8842 for Q1 infrastructure ($4,280) is due March 28.

Line items:
- Production hosting: $2,900
- Staging environment: $980
- Support plan: $400

Please confirm payment date or flag any disputes by March 25.

Thanks,
CloudStack Accounts`,
    unread: true,
    hoursAgo: 4,
  },
  {
    threadId: "demo-thread-client-contract",
    subject: "Contract renewal — signature needed by April 1",
    fromName: "Michael Torres",
    fromAddress: "michael@acmecorp.com",
    body: `Hi,

Our enterprise agreement expires April 1. Legal sent the renewal draft — main changes are:
- Seat count 50 → 75
- SLA uptime 99.5% → 99.9%
- Annual prepay discount 8%

Can you review and sign this week? Happy to loop in your counsel.

Michael`,
    unread: true,
    hoursAgo: 5,
  },
  {
    threadId: "demo-thread-hiring",
    subject: "Offer letter — Alex Kim (Senior Engineer)",
    fromName: "People Ops",
    fromAddress: "hr@thread.dev",
    body: `Hi,

Alex Kim accepted verbally. Offer letter is attached in Drive — start date April 7.

Action needed: approve compensation band and send official offer by tomorrow so we don't lose them to the competing offer.

— People Ops`,
    unread: true,
    hoursAgo: 6,
  },
  {
    threadId: "demo-thread-meeting-prep",
    subject: "Tomorrow 11am — Corsair hackathon judge walkthrough",
    fromName: "Ishaan",
    fromAddress: "demo@thread.dev",
    body: `Reminder for tomorrow's session:

Agenda (30 min):
- Daily Brief + Needs attention flow
- Agent → queue_email demo
- Queue approve (HITL)
- Calendar quick-add

Prep: seed data refreshed, demo login tested, OPENAI_API_KEY set.`,
    unread: true,
    hoursAgo: 8,
  },
  {
    threadId: "demo-thread-followup",
    subject: "Re: Partnership intro — still waiting on your reply",
    fromName: "Alex Rivera",
    fromAddress: "alex@partner.io",
    body: `Hey,

Circling back on the partnership intro from last week. Our BD team is ready to move — just need your thumbs up on the pilot scope.

Can you send a quick reply today?

Alex`,
    unread: true,
    hoursAgo: 12,
  },
  {
    threadId: "demo-thread-security",
    subject: "Action required: SOC 2 auditor questions",
    fromName: "Compliance",
    fromAddress: "compliance@thread.dev",
    body: `Team,

Auditor sent 12 follow-up questions on access controls and data retention. Due Wednesday.

Most urgent: document our human-in-the-loop approval flow for outbound email and calendar actions.

Please assign an owner in today's standup.`,
    unread: true,
    hoursAgo: 18,
  },
  {
    threadId: "demo-thread-team-sync",
    subject: "Notes from product sync — ship queue UX polish",
    fromName: "Product",
    fromAddress: "product@thread.dev",
    body: `Notes from today's sync:

Decisions:
- Queue card shows payload preview before approve
- Demo mode uses seeded Postgres data, not hardcoded UI

Next: judge walkthrough script in DEMO.md

No reply needed — FYI.`,
    unread: false,
    hoursAgo: 22,
  },
  {
    threadId: "demo-thread-calendar-conflict",
    subject: "Conflict: Investor call overlaps with team review",
    fromName: "Calendar",
    fromAddress: "calendar@thread.dev",
    body: `Heads up — you have two events tomorrow 2–3pm:
- Investor update (Sarah Chen)
- Product review (internal)

Suggest moving product review to 4pm or declining one invite.`,
    unread: true,
    hoursAgo: 26,
  },
  {
    threadId: "demo-thread-support",
    subject: "Re: Thread demo login not working",
    fromName: "Support",
    fromAddress: "support@thread.dev",
    body: `Hi,

For demo login issues:
1. Run pnpm db:seed after migrations
2. Set DEMO_LOGIN_ENABLED=true
3. Hit /api-auth/demo?next=/brief

Let us know if seed data looks stale.`,
    unread: false,
    hoursAgo: 48,
  },
  {
    threadId: "demo-thread-nda",
    subject: "NDA countersigned — attach to data room",
    fromName: "Legal",
    fromAddress: "legal@thread.dev",
    body: `NDA with Horizon Ventures is fully executed. PDF in legal drive.

Please attach to the data room folder before Sarah's diligence call.`,
    unread: false,
    hoursAgo: 52,
  },
  {
    threadId: "demo-thread-queue-reminder",
    subject: "You have 3 items waiting in approval queue",
    fromName: "Thread",
    fromAddress: "queue@thread.dev",
    body: `Pending in /queue:
1. Send follow-up to Sarah (term sheet)
2. Calendar invite: Judge walkthrough dry run
3. Draft: Vendor payment confirmation
4. Customer escalation reply
5. TechCrunch press quote

Nothing sends until you approve.`,
    unread: true,
    hoursAgo: 3,
  },
  {
    threadId: "demo-thread-customer-escalation",
    subject: "URGENT: Enterprise customer threatening churn — need exec reply today",
    fromName: "Customer Success",
    fromAddress: "cs@thread.dev",
    body: `Flagging P0 — Meridian Health says they'll churn unless we confirm SLA credits by 5pm ET today.

Their VP forwarded our last outage postmortem and asked for a written remediation plan plus a call with you.

Can you reply today? I've drafted talking points in the queue for your approval.`,
    unread: true,
    hoursAgo: 1,
    starred: true,
  },
  {
    threadId: "demo-thread-pr-inquiry",
    subject: "TechCrunch — comment on AI inbox launch?",
    fromName: "Press Desk",
    fromAddress: "press@techcrunch.com",
    body: `Hi,

We're covering AI-native productivity tools this week. Can you confirm Thread's launch timeline and whether human approval is required before sends?

Need a quote by tomorrow noon PT. Happy to do a 10-minute call.

— Jamie, TechCrunch`,
    unread: true,
    hoursAgo: 7,
  },
  {
    threadId: "demo-thread-board-deck",
    subject: "Board deck due Monday — financials + product metrics",
    fromName: "Finance",
    fromAddress: "finance@thread.dev",
    body: `Reminder: board materials due Monday 9am.

Still missing:
- Q1 MRR bridge
- Queue approval rate / HITL metrics slide
- Demo conversion funnel

Please upload to the board folder by Sunday EOD.`,
    unread: true,
    hoursAgo: 9,
  },
  {
    threadId: "demo-thread-ci-failure",
    subject: "[Thread] Run failed: CI — main (905c625)",
    fromName: "GitHub",
    fromAddress: "notifications@github.com",
    body: `Run failed for workflow CI on main.

Failed jobs:
- typecheck (apps/web)
- integration (queue)

See logs: https://github.com/example/thread/actions/runs/123

Please reply if this blocks the demo deploy.`,
    unread: true,
    hoursAgo: 10,
  },
  {
    threadId: "demo-thread-hackathon-date",
    subject: "Corsair Hackathon — demo day July 22",
    fromName: "Corsair Events",
    fromAddress: "events@corsair.dev",
    body: `Hi,

Final reminder: Corsair Hackathon showcase is July 22. Judges expect a live walkthrough of:
- Daily Brief
- Priority inbox
- Agent + Queue (human-in-the-loop)
- Calendar quick-add

Reply if you need a dry-run slot on July 21.`,
    unread: true,
    hoursAgo: 11,
  },
  {
    threadId: "demo-thread-expense",
    subject: "Expense report #441 — approval needed",
    fromName: "Expenses",
    fromAddress: "expenses@thread.dev",
    body: `Your expense report #441 ($842.50) is waiting for manager approval.

Categories: travel, team dinner, conference pass.

Approve in Expensify or reply if any line items look wrong.`,
    unread: true,
    hoursAgo: 14,
  },
  {
    threadId: "demo-thread-api-key",
    subject: "Security alert: API key rotation overdue",
    fromName: "Security Bot",
    fromAddress: "security@thread.dev",
    body: `Action required: production API key rotation is 14 days overdue.

Rotate CORSAIR_DEV_KEY and update Railway env vars before the judge demo.

This is automated — reply only if you need an exception.`,
    unread: true,
    hoursAgo: 15,
  },
  {
    threadId: "demo-thread-partnership-pilot",
    subject: "Re: Pilot scope — 50 seats, 30-day trial",
    fromName: "Alex Rivera",
    fromAddress: "alex@partner.io",
    body: `Following up on the pilot scope we discussed:

- 50 seats
- SSO optional
- Queue approval required for all outbound mail

Legal is fine with our standard DPA. Can you confirm start date next week?`,
    unread: true,
    hoursAgo: 16,
  },
  {
    threadId: "demo-thread-rsvp",
    subject: "RSVP: Investor office hours Thursday 3pm",
    fromName: "Sarah Chen",
    fromAddress: "sarah@venture.co",
    body: `Can you confirm Thursday 3pm for office hours?

Agenda: term sheet open items + product roadmap through Q3.

Calendar invite sent separately — please accept or propose another slot.`,
    unread: false,
    hoursAgo: 20,
  },
  {
    threadId: "demo-thread-newsletter",
    subject: "Weekly digest: 12 productivity tips",
    fromName: "Productivity Weekly",
    fromAddress: "newsletter@productivity.io",
    body: `This week: inbox zero myths, async standups, and AI triage patterns.

Unsubscribe at the bottom. No action required — FYI only.`,
    unread: false,
    hoursAgo: 30,
  },
  {
    threadId: "demo-thread-promo",
    subject: "50% off annual plans — limited time",
    fromName: "SaaS Deals",
    fromAddress: "promo@saasdeals.com",
    body: `Flash sale on annual subscriptions. Unsubscribe here.

No reply needed — promotional.`,
    unread: false,
    hoursAgo: 36,
  },
  {
    threadId: "demo-thread-colleague-fyi",
    subject: "FYI: Updated demo script in Notion",
    fromName: "Ishaan",
    fromAddress: "demo@thread.dev",
    body: `Dropped the judge walkthrough script in Notion — includes Brief → Agent → Queue → Calendar.

No reply needed unless you want changes before demo day.`,
    unread: false,
    hoursAgo: 40,
  },
  {
    threadId: "demo-thread-waiting-on-vendor",
    subject: "Re: CloudStack — waiting on your payment confirmation",
    fromName: "Accounts Payable",
    fromAddress: "billing@cloudstack.io",
    body: `Hi,

We still haven't received confirmation on invoice #8842. Payment due March 28.

Please reply with expected payment date to avoid service interruption.`,
    unread: true,
    hoursAgo: 28,
  },
];

export function buildDemoQueueFixtures(): DemoQueueFixture[] {
  const tomorrow = new Date(Date.now() + 86_400_000);
  const dayAfter = new Date(tomorrow.getTime() + 3_600_000);
  const judgeSlot = new Date();
  judgeSlot.setDate(judgeSlot.getDate() + 1);
  judgeSlot.setHours(11, 0, 0, 0);
  const judgeEnd = new Date(judgeSlot.getTime() + 3_600_000);

  return [
    {
      kind: "email_send",
      title: "Send: Reply to Sarah — term sheet",
      preview: "Confirm valuation cap and pro-rata by EOD Friday",
      payload: {
        to: "sarah@venture.co",
        subject: "Re: Series A term sheet — need your input by EOD Friday",
        body: "Hi Sarah,\n\nThanks for the follow-up. I can confirm the $12M cap and pro-rata terms. Let's schedule 15 minutes tomorrow to finalize the board observer language.\n\nBest,",
      },
      status: "pending",
    },
    {
      kind: "calendar_invite",
      title: "Invite: Judge walkthrough dry run",
      preview: `${judgeSlot.toISOString()} → ${judgeEnd.toISOString()}`,
      payload: {
        summary: "Judge walkthrough dry run",
        description: "Brief → Agent → Queue → Calendar demo script",
        startDateTime: judgeSlot.toISOString(),
        endDateTime: judgeEnd.toISOString(),
        timeZone: "UTC",
      },
      status: "pending",
    },
    {
      kind: "email_draft",
      title: "Draft: Vendor payment confirmation",
      preview: "Confirm CloudStack invoice #8842 payment on March 27",
      payload: {
        to: "billing@cloudstack.io",
        subject: "Re: Invoice #8842 — payment due March 28",
        body: "Hi,\n\nPayment for invoice #8842 is scheduled for March 27. No disputes on line items.\n\nThanks,",
      },
      status: "pending",
    },
    {
      kind: "email_send",
      title: "Send: Customer escalation reply — Meridian Health",
      preview: "Confirm SLA credits and schedule exec call today",
      payload: {
        to: "vp@meridianhealth.com",
        subject: "Re: URGENT — SLA remediation plan",
        body: "Hi,\n\nThank you for your patience. We're preparing a written remediation plan and can join a call today at 4pm ET. SLA credits will be confirmed in writing by 5pm ET.\n\nBest,",
      },
      status: "pending",
    },
    {
      kind: "email_send",
      title: "Send: TechCrunch quote — AI inbox launch",
      preview: "Confirm HITL approval before outbound sends",
      payload: {
        to: "press@techcrunch.com",
        subject: "Re: TechCrunch — comment on AI inbox launch?",
        body: "Hi Jamie,\n\nHappy to provide a quote. Thread requires human approval in the Queue before any email or calendar action sends via Gmail.\n\nBest,",
      },
      status: "pending",
    },
    {
      kind: "email_draft",
      title: "Draft: Board deck — queue metrics slide",
      preview: "HITL approval rate and demo conversion stats",
      payload: {
        to: "finance@thread.dev",
        subject: "Re: Board deck due Monday",
        body: "Uploading queue approval metrics and demo funnel slides to the board folder by Sunday EOD.",
      },
      status: "pending",
    },
    {
      kind: "calendar_invite",
      title: "Invite: Investor office hours (Sarah Chen)",
      preview: "Thursday 3pm — term sheet + roadmap",
      payload: {
        summary: "Investor office hours — Sarah Chen",
        description: "Term sheet open items and Q3 roadmap",
        startDateTime: new Date(Date.now() + 2 * 86_400_000 + 15 * 3_600_000).toISOString(),
        endDateTime: new Date(Date.now() + 2 * 86_400_000 + 16 * 3_600_000).toISOString(),
        timeZone: "UTC",
      },
      status: "pending",
    },
    {
      kind: "email_send",
      title: "Send: Welcome to Thread demo",
      preview: "Sample queued email for analytics",
      payload: {
        to: "guest@example.com",
        subject: "Welcome to Thread demo",
        body: "Hi — this sample queue item shows how approval works before Gmail sends.",
      },
      status: "pending",
    },
    {
      kind: "calendar_invite",
      title: "Invite: Demo sync (approved example)",
      preview: `${tomorrow.toISOString()} → ${dayAfter.toISOString()}`,
      payload: {
        summary: "Demo sync",
        description: "Previously approved sample item",
        startDateTime: tomorrow.toISOString(),
        endDateTime: dayAfter.toISOString(),
        timeZone: "UTC",
      },
      status: "approved",
    },
    {
      kind: "email_draft",
      title: "Draft: Follow-up note (dismissed example)",
      preview: "Dismissed sample for analytics",
      payload: {
        to: "you@example.com",
        subject: "Follow-up note",
        body: "Thanks for trying Thread.",
      },
      status: "dismissed",
    },
  ];
}
