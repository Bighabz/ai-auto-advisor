---
emoji: 📋
name: prodemand-lookup
description: >
  Search Mitchell 1 ProDemand for Real Fixes, labor times, part numbers,
  and repair procedures. Uses browser automation with TAPE API fallback.
requires:
  bins:
    - node
  env:
    - PRODEMAND_USERNAME
    - PRODEMAND_PASSWORD
---

# ProDemand / Mitchell 1 Lookup

Search Mitchell 1 ProDemand for Real Fixes, labor guides, and parts info.

## When to Use

Use this skill when you need:
- Real Fixes (community-confirmed repair data from Mitchell 1)
- OEM and aftermarket labor time estimates
- Part numbers for a specific repair
- Maintenance schedules and service intervals
- Component location diagrams

## Inputs

- **Vehicle**: Year/Make/Model/Engine or VIN
- **Search query**: DTC, symptom, repair type, or maintenance service

## How It Works

1. Opens ProDemand in the managed browser (CDP)
2. Logs in with saved credentials
3. Selects vehicle by VIN or YMME
4. Searches Real Fixes and/or labor guide
5. Extracts labor times, part numbers, and procedure info
6. Returns structured results

If TAPE API access is granted (via Mitchell 1 partner approval), the skill
will use the direct API instead of browser automation for faster results.

## Output Format

Returns:
- Real Fixes matches (symptom → confirmed cause → repair)
- Labor time (hours) per operation
- Part numbers (OEM and aftermarket)
- Fluid capacities and specifications
- Related maintenance items

## Example Usage

User: "Look up labor time for timing chain replacement on 2016 Hyundai Tucson 1.6T"

User: "ProDemand Real Fixes for P0300 random misfire 2015 Chevy Equinox 2.4L"
