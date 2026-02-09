---
emoji: 🔍
name: identifix-search
description: >
  Search Identifix Direct-Hit for known fixes, ranked by success rate.
  Returns common causes, diagnostic steps, and confirmed repair outcomes.
requires:
  bins:
    - node
  env:
    - IDENTIFIX_USERNAME
    - IDENTIFIX_PASSWORD
---

# Identifix Direct-Hit Search

Search Identifix Direct-Hit for confirmed, community-reported fixes.

## When to Use

Use this skill when you need:
- Known fixes for a specific DTC code or symptom
- Success rate data (how often a given repair resolved the issue)
- Common failure patterns for a vehicle/system
- Diagnostic confirmation before recommending a repair
- "What fixed it" data from real technicians

## Inputs

- **Vehicle**: Year/Make/Model/Engine or VIN
- **Search query**: DTC code (e.g., P0420) or symptom description (e.g., "rough idle cold start")

## How It Works

1. Opens Identifix in the managed browser (CDP)
2. Logs in with saved credentials
3. Selects the vehicle
4. Searches Direct-Hit for the symptom or DTC
5. Extracts known fixes, ranked by reported success rate
6. Returns structured results

## Output Format

Returns:
- List of known fixes with success percentages
- Confirmed fix details (parts replaced, labor performed)
- Common misdiagnosis warnings
- Related symptom clusters

## Example Usage

User: "Search Identifix for P0420 on a 2019 Honda Civic 2.0L"

User: "What are the top Direct-Hit fixes for a rough idle on a 2017 Chevy Silverado 5.3L?"
