---
name: telegram-gateway
description: Telegram bot for SAM estimates
user-invocable: false
---

# Telegram Gateway

Receives messages from Telegram, runs the SAM estimate pipeline, and sends back formatted responses with PDF attachments.

## Usage

Service advisors text the bot with vehicle info + problem:

```
2019 Civic 2.0L P0420
```

The bot responds with diagnosis, repair plan, and estimate.

## Commands

- **HELP** — Show usage examples
- **STATUS** — Check service status
- **ORDER** — Order parts from last estimate
- **APPROVED** — Customer approved, order parts

## Environment Variables

- `TELEGRAM_BOT_TOKEN` — Bot token from @BotFather
