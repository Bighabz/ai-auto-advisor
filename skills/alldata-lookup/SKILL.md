---
emoji: 🔧
name: alldata-lookup
description: >
  Search AllData Repair for OEM service procedures, TSBs, DTCs, labor times,
  wiring diagrams, and teardown/installation walkthroughs with screenshots.
requires:
  bins:
    - node
  env:
    - ALLDATA_USERNAME
    - ALLDATA_PASSWORD
  config:
    - alldata_url
---

# AllData Repair Lookup

Search AllData Repair for OEM repair information for any vehicle.

## When to Use

Use this skill when you need:
- OEM repair or maintenance procedures for a specific vehicle
- Technical Service Bulletins (TSBs) related to a symptom or DTC
- Diagnostic Trouble Code (DTC) information and diagnostic steps
- Labor time estimates from OEM data
- Wiring diagrams for electrical diagnosis
- Teardown and installation procedure walkthroughs with images
- Torque specifications, fluid capacities, or special tool requirements

## Inputs

- **Vehicle identification**: VIN or Year/Make/Model/Engine (YMME)
- **Search query**: DTC code (e.g., P0420), symptom description, or system/component name

## How It Works

1. Opens AllData Repair in the managed browser (CDP)
2. Logs in using saved credentials (reuses session cookies when available)
3. Navigates to the vehicle using VIN or YMME selector
4. Searches for the requested repair/diagnostic information
5. Extracts procedure text, specifications, and part numbers
6. Captures screenshots of step-by-step procedures and diagrams
7. Returns structured results with images to the conversation

## Output Format

Returns:
- Procedure title and section
- Step-by-step instructions (text)
- Screenshots of diagrams and procedure illustrations
- Torque specs, fluid capacities, and special tools (when applicable)
- Related TSBs and DTCs
- Estimated labor time (OEM)

## Example Usage

User: "Look up the brake pad replacement procedure for a 2020 Toyota Camry 2.5L"

User: "Search AllData for TSBs related to P0171 on a 2018 Ford F-150 3.5L EcoBoost"

User: "Get the wiring diagram for the O2 sensor circuit on a 2019 Honda Civic"

## Notes

- AllData does not have a public API. This skill uses browser automation.
- First login may take 10-15 seconds. Subsequent lookups reuse the session.
- Screenshots are captured at 1920x1080 resolution for readability.
- If AllData's UI changes, the snapshot-based navigation should still work,
  but selectors in search.js may need updating.
