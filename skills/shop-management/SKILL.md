---
name: shop-management
description: >
  Multi-shop configuration, onboarding, and usage analytics for SAM.
  Manages shop settings, platform credentials, and usage dashboards
  via Supabase. Falls back to local JSON config for single-shop deployments.
requires:
  bins:
    - node
  env:
    - SUPABASE_URL
    - SUPABASE_ANON_KEY
  config:
    - shops table in Supabase
    - shop_usage table in Supabase
---

# Shop Management

Multi-shop support for SAM. Handles onboarding new shops, managing per-shop settings, and tracking usage analytics.

## When to Use

Use this skill when:
- A new shop wants to use SAM (onboarding)
- You need to load shop-specific settings (config)
- You need to track estimate/diagnosis events (usage)
- You need to view shop analytics or monthly reports (dashboard)

## Modules

### 1. Config (`scripts/config.js`)

Loads shop settings from Supabase or falls back to local JSON.

| Function | Description |
|---|---|
| `getShopConfig(shopId?)` | Get config in orchestrator format. Falls back to local JSON if no shopId. |
| `getShopById(idOrSlug)` | Look up shop by UUID or slug |
| `listActiveShops()` | List all active shops |
| `updateShopSettings(shopId, update)` | Partial merge of settings |
| `getShopPlatforms(shopId)` | Check which platforms are enabled and configured |

### 2. Onboard (`scripts/onboard.js`)

Creates new shop records and validates setup.

| Function | Description |
|---|---|
| `onboardShop({ name, slug, ownerEmail, settings, platforms })` | Create shop record, generate env template |
| `validatePlatformAccess(platformKeys?)` | Check which platform env vars are set |
| `generateEnvTemplate(shopId, platformKeys)` | Generate .env template for a shop |
| `deactivateShop(shopId)` | Soft-delete a shop |

### 3. Usage (`scripts/usage.js`)

Tracks events and provides analytics dashboards.

| Function | Description |
|---|---|
| `trackEvent(shopId, eventType, metadata)` | Log a usage event (non-fatal) |
| `getShopDashboard(shopId)` | This month + 90-day stats, top repairs, platform usage |
| `getShopMonthlyReport(shopId, yearMonth)` | Daily breakdown, revenue estimate, top vehicles |

**Event types:** `estimate_created`, `diagnosis_run`, `order_placed`, `history_synced`, `canned_job_used`, `parts_searched`

## Onboarding Flow

```
Shop owner provides: name, logins, preferences
     |
     +-- 1. onboardShop({ name, slug, settings, platforms })
     |        → creates record in Supabase shops table
     |        → returns shop ID + env template + next steps
     |
     +-- 2. Shop sets env vars from template
     |        → SUPABASE_URL, SUPABASE_ANON_KEY, ANTHROPIC_API_KEY
     |        → Platform credentials (ALLDATA_*, IDENTIFIX_*, etc.)
     |        → SHOP_ID=<uuid>
     |
     +-- 3. validatePlatformAccess()
     |        → checks which platform env vars are set
     |        → reports configured vs missing
     |
     +-- 4. Test with a sample estimate request
              → SAM loads config via getShopConfig(SHOP_ID)
              → all data flows through with shop_id context
```

## Supported Platforms

| Key | Name | Env Vars Required |
|---|---|---|
| `alldata` | AllData Repair | ALLDATA_USERNAME, ALLDATA_PASSWORD |
| `identifix` | Identifix Direct-Hit | IDENTIFIX_USERNAME, IDENTIFIX_PASSWORD |
| `prodemand` | ProDemand / Mitchell 1 | PRODEMAND_USERNAME, PRODEMAND_PASSWORD |
| `partstech_api` | PartsTech (API) | PARTSTECH_API_KEY |
| `partstech_browser` | PartsTech (Browser) | PARTSTECH_URL, PARTSTECH_USERNAME |
| `autoleap` | AutoLeap | AUTOLEAP_PARTNER_ID, AUTOLEAP_AUTH_KEY |
| `ari` | ARI Labor Guides | ARI_URL |

## Backward Compatibility

When no `SHOP_ID` env var is set, `getShopConfig()` falls back to reading `config/shop-config.json`. This means existing single-shop deployments work unchanged — no migration needed.

## Scripts

| File | Purpose |
|---|---|
| `scripts/config.js` | Shop config loading and management |
| `scripts/onboard.js` | Shop creation and setup validation |
| `scripts/usage.js` | Event tracking and analytics dashboards |
