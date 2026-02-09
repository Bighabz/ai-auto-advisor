---
emoji: 🛒
name: partstech-search
description: >
  Search PartsTech for auto parts with live pricing and inventory from 225+ suppliers.
  Direct REST API integration — no browser automation needed.
requires:
  bins:
    - node
  env:
    - PARTSTECH_API_KEY
    - PARTSTECH_USERNAME
---

# PartsTech Parts Search

Search for auto parts with live pricing from connected suppliers via PartsTech API.

## When to Use

Use this skill when you need:
- Parts pricing (OEM and aftermarket) for a specific vehicle and repair
- Live inventory availability from local suppliers
- Part number lookups by VIN + component
- Price comparison across suppliers
- Parts ordering

## Inputs

- **Vehicle**: VIN (preferred) or Year/Make/Model/Engine
- **Part type**: Component name or OEM part number
- **Filters** (optional): OEM only, aftermarket only, preferred supplier

## How It Works

1. Calls PartsTech REST API with vehicle and part info
2. Returns live pricing from all connected suppliers (30k+ locations)
3. Includes: price, brand, part number, availability, supplier name
4. Results sorted by price or supplier preference

## Output Format

Returns for each matching part:
- Part description and number
- Brand (OEM manufacturer vs aftermarket brand)
- Price per unit
- Availability (in stock / order)
- Supplier name and location
- Core charge (if applicable)

## Example Usage

User: "Find pricing for downstream O2 sensor for 2019 Honda Civic 2.0L"

User: "Compare OEM vs aftermarket brake pads for 2020 Toyota Camry"

## Notes

- PartsTech account is free — sign up at partstech.com
- You must connect your local suppliers in the PartsTech dashboard
- API key is obtained from your PartsTech account settings
