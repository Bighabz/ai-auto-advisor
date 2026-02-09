# OpenClaw Reference — SAM Project

Quick reference for building browser automation skills in SAM.

**Repo:** https://github.com/openclaw/openclaw
**Docs:** https://openclaw.ai

---

## Architecture

OpenClaw is a local-first AI assistant framework with:
- **Gateway** — WebSocket control plane, routes messages from WhatsApp/Telegram/Slack
- **Pi agent** — AI runtime with tool-calling (Claude/GPT/etc.)
- **Browser tool** — Managed Chromium via Chrome DevTools Protocol (CDP)
- **Skills** — SKILL.md-based capabilities the agent can invoke

SAM runs as a set of OpenClaw workspace skills. Messages come in from messaging channels, the agent routes to the appropriate skill (estimate builder, diagnostics, etc.), and skills execute using tools (browser, bash, etc.).

---

## Browser Automation

### Profiles

| Profile | Description | Use Case |
|---------|-------------|----------|
| `openclaw` | Managed Chromium, isolated user data, dedicated CDP port | Recommended for automation |
| `chrome` | Extension relay to existing Chrome tabs | Drive existing logged-in sessions |
| Remote | CDP URL to external browser | Hosted/distributed setups |

Config in `~/.openclaw/openclaw.json`:
```json5
{
  browser: {
    defaultProfile: "openclaw",
    profiles: {
      openclaw: { cdpPort: 18800 }
    }
  }
}
```

### Snapshot & Ref System

**Critical**: Element refs are NOT stable across page navigations. Always re-snapshot after navigating.

```bash
# AI snapshot — numeric refs (e.g., 12, 23)
openclaw browser snapshot

# Interactive snapshot — role-based refs (e.g., e12)
openclaw browser snapshot --interactive

# Efficient mode — compact, flat list of actionable elements
openclaw browser snapshot --efficient
```

### Core Commands

```bash
# Lifecycle
openclaw browser status
openclaw browser start
openclaw browser stop

# Navigation
openclaw browser open https://web.ari.app
openclaw browser navigate https://example.com

# Capture
openclaw browser screenshot [--full-page]
openclaw browser snapshot

# Actions (ref from snapshot)
openclaw browser click 12 [--double]
openclaw browser type 23 "hello" [--submit]
openclaw browser press Enter
openclaw browser hover 44
openclaw browser select 9 "Option A"
openclaw browser scrollintoview e12

# Wait
openclaw browser wait --url "**/dashboard"
openclaw browser wait --load networkidle
openclaw browser wait "#main-content"
openclaw browser wait --fn "window.ready===true" --timeout-ms 15000

# Tabs
openclaw browser tabs
openclaw browser tab new
openclaw browser tab select 2
openclaw browser tab close 2

# State
openclaw browser cookies [set|clear]
openclaw browser storage local|session [get|set|clear]

# Debugging
openclaw browser console [--level error]
openclaw browser errors [--clear]
openclaw browser evaluate --fn '(el) => el.textContent' --ref 7
openclaw browser highlight e12
```

### Profile Flag

All commands accept `--browser-profile <name>`:
```bash
openclaw browser --browser-profile openclaw open https://web.ari.app
openclaw browser --browser-profile openclaw snapshot
openclaw browser --browser-profile openclaw click 12
```

---

## Skills System

### SKILL.md Format

```markdown
---
name: skill-name
description: What the skill does
---

# Skill Name

Instructions for the agent...
```

Optional frontmatter keys:
- `user-invocable: true|false` — expose as slash command
- `homepage` — URL
- `metadata` — JSON object with requirements, gating, etc.

### Skill Loading (Precedence)

1. **Workspace skills** (`<workspace>/skills/`) — highest priority (SAM uses this)
2. **Managed skills** (`~/.openclaw/skills/`)
3. **Bundled skills** — shipped with install
4. **Extra directories** — via `skills.load.extraDirs`

### Requirements & Gating

In `metadata.openclaw` JSON:
```json
{
  "requires": {
    "bins": ["node"],
    "env": ["ARI_USERNAME", "ARI_PASSWORD"]
  }
}
```

### Environment Injection

Via `~/.openclaw/openclaw.json`:
```json5
{
  skills: {
    entries: {
      "ari-labor": {
        enabled: true,
        env: { ARI_USERNAME: "user", ARI_PASSWORD: "pass" }
      }
    }
  }
}
```

---

## SAM-Specific Patterns

### How SAM Skills Use Browser Automation

Skills use `execSync()` from Node.js to call OpenClaw browser CLI:

```javascript
const { execSync } = require("child_process");

function ensureBrowser() {
  try {
    const status = execSync(
      'openclaw browser --browser-profile openclaw status',
      { encoding: "utf-8" }
    );
    if (!status.includes("running")) {
      execSync('openclaw browser --browser-profile openclaw start');
    }
  } catch {
    execSync('openclaw browser --browser-profile openclaw start');
  }
}

async function login(url, username, password) {
  ensureBrowser();

  // Navigate
  execSync(
    `openclaw browser --browser-profile openclaw open "${url}"`,
    { encoding: "utf-8" }
  );

  // Check if login needed via snapshot
  const snapshot = execSync(
    'openclaw browser --browser-profile openclaw snapshot',
    { encoding: "utf-8" }
  );

  if (snapshot.includes("username") || snapshot.includes("login")) {
    // Type credentials using refs from snapshot
    execSync(`openclaw browser --browser-profile openclaw type <ref> "${username}"`);
    execSync(`openclaw browser --browser-profile openclaw type <ref> "${password}"`);
    execSync('openclaw browser --browser-profile openclaw click <ref>');
    await new Promise((r) => setTimeout(r, 3000));
  }
}
```

### Key Pattern: Snapshot → Parse → Act

1. Navigate to page
2. Take snapshot (get element refs)
3. Parse snapshot to find target elements
4. Act on elements using refs
5. Wait for page update
6. Re-snapshot to verify / get new refs

### Error Handling

```javascript
// Graceful degradation — return error object, don't throw
try {
  const result = await lookupLabor(make, model, year, procedure);
  return result;
} catch (err) {
  console.error(`[ari-labor] Error: ${err.message}`);
  return { error: err.message };
}
```

### Session Persistence

- Browser cookies persist across commands (no re-login each time)
- Check snapshot for login form presence before authenticating
- Use the `openclaw` profile for managed, isolated sessions

---

## Relevant Docs

| Doc | Content |
|-----|---------|
| `docs/tools/browser.md` | Full browser tool reference |
| `docs/tools/skills.md` | Skills system details |
| `docs/tools/creating-skills.md` | Creating custom skills |
| `docs/tools/browser-login.md` | Login automation patterns |
| `docs/concepts/agent-loop.md` | How the agent loop works |
| `docs/concepts/architecture.md` | System architecture |
