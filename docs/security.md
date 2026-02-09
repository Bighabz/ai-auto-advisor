# Security Considerations

## ⚠️ Critical: OpenClaw Skill Supply Chain Attacks

As of February 2026, **341 malicious skills were discovered on ClawHub** distributing password-stealing malware (Atomic Stealer) via ClickFix instructions. Sources:
- [The Hacker News](https://thehackernews.com/2026/02/researchers-find-341-malicious-clawhub.html)
- [BleepingComputer](https://www.bleepingcomputer.com/news/security/malicious-moltbot-skills-used-to-push-password-stealing-malware/)

**This repo contains only custom-built skills. Do not install skills from ClawHub or third-party sources without thorough code review.**

---

## Deployment Security

### Do

- **Deploy on a dedicated VPS** — never run OpenClaw on a personal or shop computer
- **Use DigitalOcean's 1-Click deploy** — includes hardened firewall, Docker isolation, non-root execution
- **Authenticate all access** via the OpenClaw gateway token
- **Store credentials in environment variables** — never hardcode in skill scripts
- **Keep `.env` files out of git** — the `.gitignore` in this repo already handles this
- **Run the managed browser in an isolated Docker container** — don't use `chrome` profile mode
- **Audit skill code** before installing — review every line of every script
- **Enable Docker container isolation** for the sandbox environment
- **Use SSH keys** (not passwords) for VPS access
- **Keep the VPS patched** — enable automatic security updates

### Don't

- **Don't install random skills** from ClawHub or GitHub without code review
- **Don't run on a shop computer or personal machine** — the AI has system-level access
- **Don't store customer PII** in OpenClaw's memory without understanding the implications
- **Don't give OpenClaw access to payment systems** (PCI compliance concerns)
- **Don't use `tools.elevated` setting** unless you fully understand what it bypasses
- **Don't expose the web dashboard** to the public internet without authentication
- **Don't use a Claude Max subscription** for automated API access (violates Anthropic TOS)

---

## Credential Management

| Credential | Storage Method | Rotation |
|-----------|---------------|----------|
| Anthropic API Key | `.env` file on VPS | Rotate quarterly |
| AllData username/password | `.env` file on VPS | Per shop policy |
| Identifix username/password | `.env` file on VPS | Per shop policy |
| ProDemand username/password | `.env` file on VPS | Per shop policy |
| PartsTech API Key | `.env` file on VPS | Rotate quarterly |
| AutoLeap Partner credentials | `.env` file on VPS | Per AutoLeap policy |
| OpenClaw Gateway Token | Generated at deploy | Rotate if compromised |

---

## Browser Automation Security

- OpenClaw's managed browser runs in an **isolated profile** separate from any personal browsing
- Browser sessions are sandboxed in Docker
- Cookies and auth sessions are stored locally on the VPS (not transmitted)
- **Risk**: If the VPS is compromised, saved sessions could be used to access shop's repair databases
- **Mitigation**: Use strong VPS passwords/SSH keys, enable firewall, restrict port access

---

## Data Privacy

- Customer names, phone numbers, and vehicle info pass through Claude's API
- Anthropic's API data retention policies apply — review at https://www.anthropic.com/policies
- Shop repair data from AllData/Identifix/ProDemand passes through Claude for summarization
- **Recommendation**: Inform shop owner that customer data is processed via AI API
- **Recommendation**: Do not store SSNs, credit card numbers, or other sensitive financial data

---

## Network Hardening

For the DigitalOcean VPS, apply these firewall rules:

```bash
# Only allow SSH, HTTPS, and OpenClaw gateway port
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp    # SSH
ufw allow 443/tcp   # HTTPS (if using web dashboard)
ufw allow 3000/tcp  # OpenClaw gateway (restrict to known IPs if possible)
ufw enable
```

If using the DigitalOcean 1-Click image, these are pre-configured with rate limiting.
