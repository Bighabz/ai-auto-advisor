# Reference Commands and Checklists

This file provides copy-paste command snippets for the `clawdbot-estimate-reliability` skill.

## 1) Pi Connectivity and Service Health

```bash
ssh sam@192.168.1.31 "hostname && date && uptime"
```

```bash
ssh sam@192.168.1.31 "sudo systemctl status sam-telegram --no-pager"
```

```bash
ssh sam@192.168.1.31 "sudo journalctl -u sam-telegram -n 120 --no-pager"
```

Live logs:

```bash
ssh sam@192.168.1.31 "sudo journalctl -u sam-telegram -f"
```

## 2) Chrome/CDP Health

Check debugger endpoint:

```bash
ssh sam@192.168.1.31 "curl -s http://127.0.0.1:18800/json/version"
```

List open targets:

```bash
ssh sam@192.168.1.31 "curl -s http://127.0.0.1:18800/json/list"
```

## 3) Git Sync and Deploy

From local repo:

```bash
git status
git log --oneline -8
git push origin master
```

On Pi pull + restart:

```bash
ssh sam@192.168.1.31 "cd /home/sam/ai-auto-advisor && git pull origin master && sudo systemctl restart sam-telegram && sudo systemctl status sam-telegram --no-pager"
```

If pull fails due to local changes on Pi:

```bash
ssh sam@192.168.1.31 "cd /home/sam/ai-auto-advisor && git status"
```

Resolve safely by committing/stashing intentionally (do not discard unknown work).

## 4) Environment Validation (Pi)

Confirm required env vars are present in runtime context:

```bash
ssh sam@192.168.1.31 "cd /home/sam/ai-auto-advisor && python3 - << 'PY'
import os
keys = [
  'AUTOLEAP_EMAIL',
  'AUTOLEAP_PASSWORD',
  'PRODEMAND_USERNAME',
  'PRODEMAND_PASSWORD'
]
for k in keys:
    print(f'{k}={"SET" if os.getenv(k) else "MISSING"}')
PY"
```

For one-off shell tests with `.env`:

```bash
ssh sam@192.168.1.31 "cd /home/sam/ai-auto-advisor && set -a && source config/.env && set +a && env | egrep 'AUTOLEAP_|PRODEMAND_'"
```

## 5) Isolated PartsTech Pricing Test

```bash
ssh sam@192.168.1.31 "cd /home/sam/ai-auto-advisor && set -a && source config/.env && set +a && node -e \"const { searchPartsPricing } = require('./skills/autoleap-browser/scripts/partstech-search'); searchPartsPricing({ year: 2002, make: 'Toyota', model: 'RAV4', partsList: [{ partType: 'catalytic converter', qty: 1 }] }).then(r => console.log(JSON.stringify(r, null, 2))).catch(e => console.error(e.message));\""
```

Expected good signals:
- PartsTech tab opened (or found)
- search input found
- product events captured
- non-empty quotes or explicit reason code

## 6) Primary End-to-End Test Prompts

Send these to `@hillsideautobot`:

1. `2002 Toyota RAV4 needs new catalytic converter customer John 555-1234`
2. `2002 Toyota RAV4 needs new catalytic converter customer John`
3. `2019 Honda Civic oil change`
4. `2014 Toyota Prius needs catalytic converter`
5. `2011 Honda Accord needs alternator`

## 7) Log Assertions by Stage

Use this helper to pull recent logs:

```bash
ssh sam@192.168.1.31 "sudo journalctl -u sam-telegram --since '10 min ago' --no-pager -l"
```

Check for these indicators:

- Telegram ack quickly sent
- ProDemand engine selected (not EV/plugin for emissions jobs)
- ProDemand labor hours resolved (or explicit fallback reason)
- PartsTech product responses captured
- AutoLeap estimate create success
- PDF source identified (REST / puppeteer fallback / local fallback)

## 8) Failure Signature Cheat Sheet

- `AUTOLEAP_EMAIL / AUTOLEAP_PASSWORD not set`
  - Runtime env missing in service or shell context.
- AutoLeap tab on `/#/login`
  - Session expired; token capture/login path needed.
- `Engine selected: (none)` or breadcrumb stuck on EV
  - Engine selection race or stale vehicle state.
- PartsTech snapshot empty / no search input
  - App not rendered yet or wrong tab/context.
- `Required fields missing` on customer create
  - Invalid customer payload (single-word name handling).
- Estimate created but local PDF used unexpectedly
  - AutoLeap PDF retrieval path failed; inspect REST/fallback logs.

## 9) Safe Remediation Checklist

1. Reproduce once with trace id.
2. Apply one targeted fix.
3. Re-test same prompt.
4. Validate reason code changed/cleared.
5. Commit and push.
6. Pull on Pi and restart service.
7. Re-run verification matrix.

## 10) Deployment Verification Summary Template

```markdown
Deploy SHA: <sha>
Service: sam-telegram (running/not running)
Trace ID: <id>

Test Prompt: <prompt>
Result: SUCCESS | DEGRADED | FAILED

- ProDemand engine: <value>
- Labor: <hours/source or reason>
- PartsTech: <count/selected/reason>
- AutoLeap estimate: <id/code or reason>
- PDF source: <rest|puppeteer|local>
- Reason codes: <list>

Next action: <one clear action>
```

