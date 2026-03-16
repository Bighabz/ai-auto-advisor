# Feature Landscape

**Domain:** Conversational AI service advisor (internal shop-facing, messaging-based)
**Researched:** 2026-03-15
**Scope:** Conversational UX layer only — estimate pipeline already built. This covers how SAM talks, routes, and handles edge cases.

---

## Context: What SAM Already Has

The estimate pipeline is complete. This research covers only the conversational layer sitting on top of it:
- A tech texts SAM a vehicle + problem
- SAM runs a 10-20 minute pipeline (research + parts + AutoLeap estimate)
- SAM responds with structured estimate data + PDF

The conversational layer governs everything *around* that pipeline: how SAM collects inputs, communicates progress, handles failures, answers non-estimate questions, and sends results downstream.

---

## Table Stakes

Features users expect. Missing any of these means the tool feels broken or untrustworthy.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Immediate acknowledgment on submit | Users on Telegram/WhatsApp expect instant read receipt. 60-second silence = assumed broken. | Low | Plain-text "On it!" before pipeline starts. Already partially implemented per PROJECT.md. |
| Progress updates during long tasks | Pipeline is 10-20 min. No updates = techs assume it crashed and re-submit. | Low-Med | Milestone messages: "Pulling ProDemand data...", "Searching PartsTech...", "Building estimate in AutoLeap..." |
| Partial results over silence | When parts fail or labor lookup times out, a partial estimate is far more useful than nothing. | Med | Show what succeeded. Flag what failed with a specific reason. |
| Customer info collection before running | AutoLeap playbook requires customer name + phone number. Asking after estimate runs wastes the pipeline run. | Low-Med | Two-step: collect name + phone conversationally, then run. |
| Clear error messages in plain language | Techs are not engineers. "Browser timeout on MOTOR nav" is useless. "Couldn't get MOTOR labor times, used AI estimate instead" is actionable. | Low | Translate all internal errors into plain shop language. |
| Queue awareness for concurrent requests | Pi has one Chrome instance. Two requests can't run simultaneously. Tech needs to know they're queued, not ignored. | Med | "Got it — one estimate running already. Yours is next, I'll start in ~15 min." |
| General automotive knowledge fallback | Techs will text questions that aren't estimate requests ("what torque spec for 5.7 Hemi head bolts?"). Dead silence or "I don't understand" destroys trust. | Med | Route non-estimate queries to Claude for direct automotive answers without triggering pipeline. |
| Consistent advisor personality | Shop staff will use SAM daily. Inconsistent tone (robotic one message, casual the next) feels unreliable. | Low | Establish tone: professional but conversational. Short messages. No corporate speak. |

---

## Differentiators

Features that go beyond expectation and create genuine competitive advantage.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Named advisor persona ("SAM") | Creates psychological continuity. Staff say "ask SAM" rather than "use the tool." Personality = retention. | Low | Consistent name, consistent sign-off style. "SAM here." Not "AI Assistant." |
| Confidence signals in estimates | "MOTOR gave us 2.5h for this job" feels more trustworthy than just "2.5h". Sourcing builds credibility. | Low-Med | Already partially implemented via platform research display. Expose it conversationally. |
| History-aware context | "Last time this RAV4 was in, you replaced the O2 sensor" — pulls from AutoLeap history without being asked. Saves the tech from switching to AutoLeap just to check. | Med | AutoLeap history skill already built. Wire it into greeting/context step. |
| Send estimate to customer from chat | Tech texts "send to customer" → SAM emails/texts the PDF to the vehicle owner. No manual export + copy-paste. | Med | Requires customer phone/email from estimate. Adds outbound messaging capability. |
| Proactive warnings before they bite | "Heads up — PartsTech showed no OEM availability for this part, aftermarket only." Surfaced before shop commits. | Med | Warnings already tracked in results.warnings[]. Surface them prominently in the message, not buried. |
| Repair history query | "What did we do on this 2019 Camry last time?" answered directly in chat without opening AutoLeap. | Med | history.js skill already built. Needs conversational routing to reach it. |
| Job status mid-pipeline | Tech can ask "is that estimate done yet?" and SAM responds with current step. | Med-High | Requires persistent state for in-flight jobs. Queue system tracks this. |
| Multi-tech isolation | Different techs in the same Telegram group should get their own job results, not each other's. | Med | Route responses back to originating user. Conversation context per user. |
| Canned job suggestions | For common services (oil change, brake job), SAM can offer pre-built estimates without running full pipeline. | Med | canned-jobs.js already built. Surface it when incoming job matches a known pattern. |

---

## Anti-Features

Things to deliberately NOT build in this milestone.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Customer-facing chat | PROJECT.md explicitly out of scope. Adds auth complexity, tone mismatch, liability concerns. SAM talks to shop staff only. | Keep SAM internal. Customer communication is outbound (send PDF), not inbound (chatbot). |
| Voice / call support | Out of scope per PROJECT.md. Adds transcription latency, telephony cost, and reliability risk on Pi hardware. | Stay text-based. WhatsApp voice memos are a different problem. |
| Rich UI / web dashboard | Messaging IS the UI. A web dashboard is a separate product with separate scope. | All interactions stay in Telegram/WhatsApp. |
| Approval workflows (customer-side) | Bolton Technology's model of customers approving via link adds customer auth, notification flows, and fallback paths. Not this milestone. | Approval = shop owner sees the estimate and says "order it." That's already handled. |
| Multi-shop SaaS features | Billing, onboarding portals, tenant isolation are all out of scope per PROJECT.md. | Hillside Auto first. Multi-shop wiring already exists in shop-management skill but don't extend it. |
| Automated follow-up campaigns | CRM-style drip campaigns for customers are a different product. Not shop-internal workflow. | Out of scope. |
| Chatbot builder / no-code configurability | SAM is a custom built tool, not a platform for others to configure. Flexibility adds complexity without payoff here. | Hard-code the workflow. Config lives in env vars. |
| Intent classification over-engineering | Building a full NLU pipeline (entity extraction, slot filling, dialog manager) for a shop of 3-5 users is massive overkill. | Claude handles routing. Keep it prompt-based, not a trained classifier. |

---

## Feature Dependencies

The following ordering constraints matter for implementation:

```
Customer info collection
  → Estimate pipeline run (pipeline needs name + phone)

Queue system
  → Progress updates (updates only meaningful if there is queue awareness)
  → Job status query (can only answer "where is my job" if job state is tracked)

General knowledge routing
  → (independent — can be added without pipeline changes)

Partial results
  → Error recovery (partial results IS error recovery for pipeline failures)

History-aware context
  → Repair history query (same history.js skill, same data source)

Send estimate to customer
  → Customer info collection (needs phone/email to send to)
  → Estimate pipeline completion (needs a completed estimate)

Canned job suggestions
  → Customer info collection (still need name + phone if job runs)
  → canned-jobs.js skill (already built)
```

---

## MVP Recommendation

The conversational layer is non-negotiable for daily use. Prioritize in this order:

**Must ship first (the tool is broken without these):**
1. Immediate acknowledgment — single plain-text message before pipeline starts
2. Progress updates — 3-4 milestone messages during the 15-min pipeline
3. Plain-language error messages — translate all errors before surfacing them
4. Customer info collection flow — conversational gather before pipeline triggers
5. Queue serialization — block second request, inform tech of position

**Ship second (trust-builders):**
6. General automotive knowledge fallback — answer non-estimate questions via Claude
7. Partial results with explicit sourcing — show what worked, flag what didn't
8. Consistent advisor personality — named "SAM", short professional messages

**Ship when pipeline is stable (differentiators):**
9. Send estimate to customer from chat command
10. Repair history query ("what did we do on this car?")
11. Canned job suggestions for common services
12. History-aware context on new estimates
13. Job status mid-pipeline query
14. Multi-tech isolation in group chats

**Defer indefinitely:**
- Customer-facing chatbot
- Rich UI / dashboard
- Approval workflow (customer-side)
- Multi-shop SaaS extensions

---

## Confidence Assessment

| Claim | Confidence | Source |
|-------|------------|--------|
| Progress updates are table stakes for long-running chat tasks | HIGH | Multiple UX design sources + chatbot best practices 2025-2026 |
| Partial results over silence for pipeline failures | HIGH | AI error recovery UX patterns (aiuxdesign.guide); field service AI best practices |
| Customer info before pipeline is required for AutoLeap | HIGH | PROJECT.md — AutoLeap playbook requires name + phone |
| Queue serialization required given single Chrome | HIGH | PROJECT.md — Pi hardware constraint explicitly documented |
| General knowledge fallback critical for daily trust | MEDIUM | Automotive chatbot best practices; automotive shop AI 2025 |
| Canned jobs as differentiator | MEDIUM | Shop AI productivity research (canned-jobs.js already built in codebase) |
| Named advisor persona increases retention | MEDIUM | Conversational AI brand personality research; automotive advisor tools |
| Customer-facing chatbot is anti-feature | HIGH | PROJECT.md explicit out-of-scope; distinct user base from internal advisors |

---

## Sources

- [What an AI Service Advisor Means for Small Shops](https://blog.boltontechnology.com/what-an-ai-service-advisor-means-for-small-shops) — Bolton Technology: automated follow-ups, text-based workflow, response time reduction
- [How Can Auto Repair Shops Use AI in 2025?](https://conceptualminds.com/how-can-auto-repair-shops-use-ai-in-2025/) — Conceptual Minds: DVI, scheduling, tech guidance, communication features
- [Mastertech.ai — Your AI Advisor Companion](https://www.mastertech.ai/) — Competitor reference: OEM data, diagnostic network, inspection workflow
- [Service AI for Dealerships — Impel AI](https://impel.ai/service-ai/) — Dealership service AI: automated campaigns, appointment scheduling, DMS integration
- [Error Recovery and Graceful Degradation — AI UX Design Guide](https://www.aiuxdesign.guide/patterns/error-recovery) — UX pattern: queue position, warm error colors, multiple recovery paths
- [AI Chatbot UX Best Practices 2026 — Groto](https://www.letsgroto.com/blog/ux-best-practices-for-ai-chatbots) — Progress indicators, persistent context, typing indicators
- [Field Service AI — Future of Field Service](https://www.futureoffieldservice.com/2025/02/24/ai-in-field-service-the-now-the-next-and-the-questions-that-remain/) — Worker-facing AI assistants, guided workflows, mobile-first
- [AI for Field Service — Simpro](https://www.simprogroup.com/blog/ai-for-field-service) — Status updates, proactive outreach, service workflow AI
- [Top AI Platforms for Service Advisor Productivity — Autymate](https://www.autymate.com/blog/top-ai-platforms-for-service-advisor-productivity-in-automotive) — Task assignment, predictive insights, DMS integration
- [AI for Automotive Repair — Dialzara](https://dialzara.com/blog/ai-in-automotive-troubleshooting-use-cases-and-guide) — Diagnostic workflow, standard vs innovative features, 60% adoption baseline
