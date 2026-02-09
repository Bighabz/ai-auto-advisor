---
emoji: 📄
name: estimate-pdf
description: >
  Generate professional PDF estimates ready to download or email to customers.
  Includes itemized breakdown, parts options, warranty info, and shop branding.
requires:
  bins:
    - node
  env: []
install: |
  npm install pdfkit
---

# Estimate PDF Generator

Creates professional, branded PDF estimates for customer delivery.

## When to Use

Use this skill when you need to:
- Generate a downloadable PDF estimate for a customer
- Email an estimate directly
- Print a physical estimate
- Create a professional quote document

## Input

- Estimate data (from estimate-builder pipeline)
- Customer info
- Vehicle info
- Line items (labor + parts)
- Shop config (branding, warranty, disclaimers)

## Output

- PDF file saved to workspace
- Returns file path for download/email
- Formatted for letter-size paper (8.5" x 11")

## PDF Contents

1. **Header**
   - Shop logo and name
   - Shop address, phone, email
   - Estimate number and date

2. **Customer & Vehicle Info**
   - Customer name and contact
   - Vehicle: Year Make Model Trim
   - VIN, Mileage, License plate

3. **Diagnosis Summary**
   - Problem description
   - Recommended repair
   - Confidence/source (Identifix success rate, etc.)

4. **Itemized Estimate**
   - Labor lines (description, hours, rate, total)
   - Parts lines (description, part #, qty, price)
   - Shop supplies
   - Tax
   - **TOTAL**

5. **Parts Options** (if applicable)
   - OEM option with price
   - Aftermarket option with price
   - Customer selection checkbox

6. **Mechanic Reference** (internal copy only)
   - Sensor locations
   - Fluid specs
   - Torque specs
   - Special tools

7. **Footer**
   - Warranty terms
   - Payment terms
   - Disclaimers
   - Authorization signature line

## Example Usage

After estimate-builder completes:
```
User: "Send me a PDF of that estimate"
→ estimate-pdf generates file
→ Returns download link
```
