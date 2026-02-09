---
emoji: 🚗
name: vin-decoder
description: >
  Decode a VIN to get Year, Make, Model, Engine, Trim, and other vehicle specs
  using the free NHTSA vPIC API. No API key required.
requires:
  bins:
    - node
---

# VIN Decoder

Decode any 17-digit VIN into structured vehicle information.

## When to Use

Use this skill when you need to:
- Identify a vehicle from its VIN
- Get Year/Make/Model/Engine/Trim details
- Verify vehicle info before searching repair databases

## Inputs

- **VIN**: 17-character Vehicle Identification Number

## How It Works

Calls the free NHTSA vPIC (Vehicle Product Information Catalog) API.
No API key needed — this is a public US government API.

## Output Format

Returns:
- Year, Make, Model, Trim
- Engine (displacement, cylinders, fuel type)
- Transmission type
- Drive type (FWD/RWD/AWD)
- Body style
- Plant info and country of origin

## Example Usage

User: "Decode VIN 1HGBH41JXMN109186"
