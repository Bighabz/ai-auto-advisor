---
emoji: 💰
name: autoleap-estimate
description: >
  Create and manage repair estimates in AutoLeap via Partner API.
  Add line items for labor, parts, and supplies. Send estimates to customers.
requires:
  bins:
    - node
  env:
    - AUTOLEAP_PARTNER_ID
    - AUTOLEAP_AUTH_KEY
---

# AutoLeap Estimate Builder

Create, update, and send repair estimates through AutoLeap's Partner API.

## When to Use

Use this skill when you need to:
- Create a new repair estimate in AutoLeap
- Add labor, parts, and supplies line items to an estimate
- Apply shop markup and tax rates
- Look up existing customer/vehicle records
- Send a completed estimate to the customer for approval
- Check estimate status

## Inputs

- **Customer**: Name, phone, email (or existing customer ID)
- **Vehicle**: VIN, Year/Make/Model, mileage
- **Line items**: Array of labor operations + parts + supplies
- **Shop config**: Labor rate, markup %, tax rate (from shop-config.json)

## How It Works

1. Authenticates with AutoLeap Partner API (token-based)
2. Looks up or creates customer record
3. Looks up or creates vehicle record
4. Creates a new estimate (repair order)
5. Adds line items (labor hours × rate, parts with markup, shop supplies)
6. Returns estimate summary with totals
7. Optionally sends estimate to customer via AutoLeap

## API Reference

- Auth: POST /partners/login → accessToken
- Customers: GET/POST /partners/customers
- Vehicles: GET/POST /partners/vehicles
- Estimates: GET/POST /partners/estimates
- Line Items: POST /partners/estimates/{id}/items

API Docs: https://developers.myautoleap.com/

## Example Usage

User: "Create an estimate for John Smith's 2019 Civic — O2 sensor replacement, 1.2 hrs labor, Denso sensor $89.99"

User: "Send the estimate to the customer"
