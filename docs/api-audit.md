# API Integration Audit

## Summary

| Platform | API Available | Auth Type | Integration Method |
|----------|:------------:|-----------|-------------------|
| AutoLeap | ✅ Yes | Token (Partner API) | Direct REST API |
| PartsTech | ✅ Yes | API Key | Direct REST API |
| Mitchell 1 ProDemand | ⚠️ Partner | TAPE Token | Apply for access; browser fallback |
| AllData Repair | ❌ No | N/A | Browser automation (CDP) |
| Identifix Direct-Hit | ❌ No | N/A | Browser automation (CDP) |

---

## Tier 1: Direct API — Build First

### AutoLeap Partner API

- **Portal**: https://developers.myautoleap.com/
- **Auth**: POST `/partners/login` with `partnerId` + `authKey` → returns `accessToken` (1hr TTL)
- **Format**: JSON REST
- **Resources**: Customers, Vehicles, Estimates, Repair Orders, Payments, Appointments
- **Action**: Email AutoLeap support to request Partner API access. Reference the developer portal.

### PartsTech API

- **Docs**: https://api-docs.partstech.com/
- **Auth**: API Key (obtained from account settings)
- **Format**: JSON REST
- **Resources**: Parts search by VIN + part type, supplier inventory, pricing, ordering
- **Action**: Sign up for free at partstech.com, connect local suppliers, get API key.

---

## Tier 2: Partner-Level API — Apply Now

### Mitchell 1 ProDemand (TAPE + Website UI Integration)

- **TAPE**: Transfer Application Public Extension — structured API for launching ProDemand with context
  - Intents: Labor, Parts, Fluids, Maintenance, Wiring, TSB, DTC
  - Partner gets a TAPE token for authenticated requests
- **Website UI Integration**: Pass VIN/ACES ID to open ProDemand directly to a vehicle
- **Apply**: https://mitchell1.com/resources/api-request/
- **Developer Portal**: https://developer.mitchell.com
- **Action**: Submit integration request form. Typical approval: weeks to months.

---

## Tier 3: Browser Automation — No API Available

### AllData Repair

- **Confirmed**: No public API as of 2026 (verified on GetApp, official docs)
- **Integration**: OpenClaw managed browser (CDP) automates the web interface
- **Flow**: Login → select vehicle (VIN/YMME) → navigate to procedures/TSBs/wiring → extract data + screenshots

### Identifix Direct-Hit

- **Confirmed**: No API for diagnostic/repair content
- **Note**: Identifix Shop Manager has limited Zapier integration for CRM data only — Direct-Hit repair data is not exposed
- **Integration**: OpenClaw managed browser (CDP) automates the web interface
- **Flow**: Login → select vehicle → search Direct-Hit → extract known fixes with success rates

---

## Free APIs Used

### NHTSA vPIC (VIN Decoder)

- **URL**: https://vpic.nhtsa.dot.gov/api/
- **Auth**: None required (public US government API)
- **Use**: Decode VIN → Year/Make/Model/Engine/Trim
- **Rate Limit**: Generous (no documented limit for reasonable use)
