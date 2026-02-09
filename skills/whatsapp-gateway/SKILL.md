---
emoji: 📱
name: whatsapp-gateway
description: >
  WhatsApp integration for SAM. Receives messages via webhook (Twilio or Meta),
  parses vehicle + symptom info, runs the full estimate pipeline, and sends
  back mobile-formatted results with PDF attachment.
requires:
  bins:
    - node
  env:
    - ANTHROPIC_API_KEY
    - SUPABASE_URL
    - SUPABASE_ANON_KEY
install: |
  npm install
---

# WhatsApp Gateway

Connects SAM to WhatsApp so techs can text a number and get estimates back.

## Setup (Twilio Sandbox — for demo)

1. Sign up at twilio.com (free trial works)
2. Go to Messaging → Try it out → WhatsApp Sandbox
3. Join the sandbox by sending the code from your phone
4. Set webhook URL to: `http://<VPS-IP>:3000/webhook`
5. Add to .env:
   ```
   WHATSAPP_PROVIDER=twilio
   TWILIO_ACCOUNT_SID=your_sid
   TWILIO_AUTH_TOKEN=your_token
   TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886
   ```

## Setup (Meta WhatsApp Business — for production)

1. Create Meta Business account + WhatsApp Business API app
2. Set webhook URL and subscribe to `messages` events
3. Add to .env:
   ```
   WHATSAPP_PROVIDER=meta
   META_WHATSAPP_TOKEN=your_token
   META_PHONE_NUMBER_ID=your_phone_id
   META_VERIFY_TOKEN=your_verify_token
   ```

## Running

```bash
node skills/whatsapp-gateway/scripts/server.js
```

## Message Examples

Tech sends:
> 2019 Civic 2.0L P0420 customer John 555-1234

SAM replies with 3-4 messages:
1. **Headline**: Vehicle + diagnosis + total estimate
2. **Details**: Diagnostic steps, parts list, repair plan
3. **Mechanic ref**: Torque specs, tools, fluids
4. **Prompt**: "Reply ORDER to place parts"

## Commands

| Command | Action |
|---------|--------|
| `ORDER` | Place parts from last estimate |
| `SEND`  | Email estimate to customer |
| `HELP`  | Show usage examples |
| `STATUS` | Check if SAM is online |
