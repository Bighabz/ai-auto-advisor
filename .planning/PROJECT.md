# SAM — AI Service Advisor

## What This Is

SAM is an AI-powered virtual service advisor for auto repair shops. Shop owners, technicians, and service writers text SAM with a vehicle and problem — SAM researches the issue across professional platforms (ProDemand, AllData, Identifix), pulls MOTOR labor times, finds parts with real pricing from PartsTech, builds a complete estimate in AutoLeap with markup, and delivers a customer-ready PDF. Any shop can plug in their credentials and SAM works as their virtual advisor.

## Core Value

A shop tech texts a vehicle and problem, and gets back a complete, accurate, customer-ready estimate with real parts pricing and labor times — no manual research, no switching between platforms.

## Requirements

### Validated

- ✓ ProDemand research (Real Fixes, labor times, DTC test plans) — existing, puppeteer-core
- ✓ AI diagnostics via Supabase vector search + Claude synthesis — existing
- ✓ PartsTech parts search with real pricing — existing
- ✓ MOTOR labor navigation in AutoLeap Browse dialog — existing
- ✓ AutoLeap browser playbook (customer, vehicle, estimate, MOTOR, PartsTech, linking, PDF) — existing
- ✓ Part-to-labor linking with AutoLeap markup matrix — existing
- ✓ Customer-facing PDF via "Print estimate" — existing
- ✓ Quality check (validate estimate totals before sending) — existing
- ✓ Telegram bot with Claude tool_use routing — existing
- ✓ Vehicle history lookup via AutoLeap API — existing
- ✓ Test run cleanup (delete estimate/customer/vehicle via API) — existing
- ✓ Safe screenshot handling (non-fatal on Pi) — existing
- ✓ PartsTech qty fix (force qty=1 for universal fit parts) — existing

### Active

- [ ] Conversational AI layer revamp — friendly, error-resilient, professional advisor personality
- [ ] Pipeline queue system — handle concurrent requests, queue with status updates
- [ ] Graceful partial results — show what we got even when parts/labor fail
- [ ] Customer info collection flow — natural conversation to gather name + phone before running estimate
- [ ] General automotive knowledge — answer car questions without triggering the estimate pipeline
- [ ] Multi-platform gateway — unified messaging layer for Telegram, WhatsApp, SMS
- [ ] Send estimate to customer — email/text the PDF to the vehicle owner
- [ ] Parts ordering on approval — place PartsTech order when shop approves
- [ ] AutoLeap history lookups — "What did we do on this car last time?"
- [ ] Error recovery and retry — browser timeouts, platform outages, partial failures handled gracefully
- [ ] Progress updates — "Working on it... pulling parts now..." instead of silence

### Out of Scope

- Multi-shop SaaS (billing, onboarding) — focus on Hillside Auto first
- Mobile app — messaging platforms are the interface
- Real-time voice/call support — text-based only
- Customer-facing chatbot — SAM talks to shop staff, not end customers
- AllData/Identifix browser automation — 403/unreachable from Pi, graceful degradation already in place

## Context

- **Existing codebase:** 11 skills, central orchestrator, Telegram + WhatsApp gateways
- **Deployment:** Raspberry Pi at 192.168.1.232 (residential IP — ProDemand works), DigitalOcean VPS at 137.184.4.157
- **Browser:** Chrome headless on port 18800, puppeteer-core for AutoLeap/ProDemand/PartsTech
- **Stack:** Node.js 22, CommonJS, no framework, Claude Sonnet for routing, OpenAI embeddings for diagnostics
- **Shop:** Hillside Auto Clinic — has AutoLeap, ProDemand, PartsTech, AllData, Identifix credentials
- **Users:** Shop owner (Habib's cousin), technicians, service writers — all text throughout the day
- **Pipeline runtime:** ~10-20 minutes per estimate on Pi (MOTOR screenshots timeout but are caught gracefully)
- **Current gaps:** Bare-bones Telegram bot, no queue for concurrent requests, no progress updates, brittle error handling, no general chat capability

## Constraints

- **Hardware:** Raspberry Pi 4 — limited RAM/CPU, single Chrome instance, one estimate at a time
- **Browser:** Single shared Chrome session — concurrent playbook runs will conflict
- **Platforms:** Must work across Telegram, WhatsApp, and potentially SMS
- **Credentials:** Using live Hillside Auto shop account — test cleanup is critical
- **Timeline:** Daily driver ASAP — shop needs this working for real jobs

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Queue concurrent requests, don't parallelize | Single Chrome instance on Pi can't handle parallel browser automation | — Pending |
| Professional advisor tone, not casual slang | Shop staff includes owner, techs, and writers — needs to feel professional | — Pending |
| Partial results over silence | A tech waiting 15 min for nothing is worse than getting labor without parts | — Pending |
| Customer name + phone required before running | Prevents incomplete estimates, ensures AutoLeap playbook has what it needs | — Pending |
| Puppeteer-core over OpenClaw | Better control for React apps (PartsTech), direct CDP, tab management | ✓ Good |

---
*Last updated: 2026-03-15 after initialization*
