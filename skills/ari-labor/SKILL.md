---
name: ari-labor
description: >
  Look up automotive labor times from ARI Free Labor Guide via browser
  automation. Caches results in Supabase labor_cache with 90-day TTL.
requires:
  bins:
    - node
    - openclaw
  env:
    - SUPABASE_URL
    - SUPABASE_ANON_KEY
  config:
    - ari_url
---

# ARI Labor Time Lookup

Look up automotive labor times from the ARI Free Labor Guide at web.ari.app using OpenClaw browser automation.

## When to Use

Use this skill when:
- The `labor_cache` table does not have a match for a specific vehicle + procedure combo
- You need live labor time data for a repair estimate
- The pre-seeded labor times (from `seed-labor-times.js`) are insufficient for the vehicle or procedure in question

This skill is called automatically by `diagnose.js` as a fallback when `lookupLaborCache()` returns null.

## Inputs

| Parameter   | Type   | Required | Description                                      |
|-------------|--------|----------|--------------------------------------------------|
| `year`      | number | Yes      | Vehicle model year                                |
| `make`      | string | Yes      | Vehicle manufacturer (e.g. "Honda")               |
| `model`     | string | Yes      | Vehicle model (e.g. "Civic")                      |
| `procedure` | string | Yes      | Repair procedure name (e.g. "Brake pads - front") |

## Output Format

On success:
```json
{
  "labor_hours": 1.2,
  "procedure_name": "Front Brake Pad Replacement",
  "notes": "Includes rotor inspection",
  "source": "ari"
}
```

On failure (graceful degradation):
```json
{
  "error": "ARI lookup failed: could not find vehicle selector"
}
```

## How It Works

1. **Ensure browser** -- Checks if the OpenClaw managed browser is running; starts it if not
2. **Navigate** -- Opens `https://web.ari.app` (or `ARI_URL` env var override)
3. **Detect page state** -- Takes a snapshot to determine if on main page or login
4. **Select vehicle** -- Uses year, make, model dropdowns/search fields to select the vehicle
5. **Search procedure** -- Enters the procedure name in the labor guide search
6. **Extract labor hours** -- Parses the results from the page snapshot
7. **Cache result** -- Stores the result in Supabase `labor_cache` table with a 90-day TTL
8. **Return** -- Returns structured labor data or an error object

## Integration with Diagnostics Engine

The `lookupLaborTime()` function from this skill is intended to be called by `diagnose.js` (Task 15) when the pre-seeded `labor_cache` has no match:

```javascript
const { lookupLaborTime } = require("../../ari-labor/scripts/lookup");

// In diagnose.js, after lookupLaborCache() returns null:
const liveResult = await lookupLaborTime({
  year: 2019,
  make: "Honda",
  model: "Civic",
  procedure: "Alternator replacement",
});

if (!liveResult.error) {
  // Use liveResult.labor_hours to override the estimate
}
```

## Caching

Results are cached in the `labor_cache` table with the following schema:

| Column           | Type        | Description                          |
|------------------|-------------|--------------------------------------|
| `vehicle_make`   | text        | Uppercase vehicle make               |
| `vehicle_model`  | text        | Uppercase vehicle model              |
| `vehicle_year`   | int         | Model year                           |
| `procedure_name` | text        | Procedure name as returned by ARI    |
| `labor_hours`    | float       | Labor hours from ARI                 |
| `labor_source`   | text        | Always `"ari"` for live lookups      |
| `notes`          | text        | Any additional notes from ARI        |
| `fetched_at`     | timestamptz | When the lookup was performed        |
| `expires_at`     | timestamptz | 90 days after fetch (cache TTL)      |

## Notes

- ARI does not have a public API. This skill uses browser automation via OpenClaw.
- Browser automation is inherently slow (5-15 seconds per lookup).
- The snapshot-based navigation should be resilient to minor UI changes on ARI.
- If ARI is unreachable or the UI changes significantly, the skill returns an error object. The diagnostics engine falls back to KB estimates gracefully.
- Environment variable `ARI_URL` can override the default ARI URL for testing or staging.

## Scripts

| File                | Purpose                                |
|---------------------|----------------------------------------|
| `scripts/lookup.js` | Main lookup and caching logic          |
