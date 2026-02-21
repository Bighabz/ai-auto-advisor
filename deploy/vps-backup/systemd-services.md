# Systemd Services from VPS

## openclaw-gateway.service
```ini
[Unit]
Description=OpenClaw Gateway
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/openclaw gateway
Restart=always
RestartSec=5
Environment=HOME=/root
EnvironmentFile=/root/ai-auto-advisor/config/.env
WorkingDirectory=/root/ai-auto-advisor

[Install]
WantedBy=multi-user.target
```

## openclaw-browser.service
```ini
[Unit]
Description=OpenClaw Browser (Chrome + Cloudflare WARP proxy)
After=openclaw-gateway.service
Requires=openclaw-gateway.service

[Service]
Type=simple
ExecStart=/usr/bin/google-chrome-stable --headless --no-sandbox --disable-gpu --disable-dev-shm-usage --remote-debugging-port=18800 --user-data-dir=/root/.openclaw/browser/openclaw/user-data --no-first-run --proxy-server=socks5://127.0.0.1:40000
Restart=always
RestartSec=5
Environment=HOME=/root

[Install]
WantedBy=multi-user.target
```

## sam-telegram.service
```ini
[Unit]
Description=SAM Telegram Bot
After=openclaw-browser.service
Requires=openclaw-browser.service

[Service]
Type=simple
WorkingDirectory=/root/ai-auto-advisor
ExecStart=/usr/bin/node skills/telegram-gateway/scripts/server.js
Restart=always
RestartSec=10
Environment=HOME=/root
EnvironmentFile=/root/ai-auto-advisor/config/.env

[Install]
WantedBy=multi-user.target
```

## sam-proxy.service (optional — only needed if using paid residential proxy)
```ini
[Unit]
Description=SAM Local Proxy (auth wrapper for residential proxy)
After=network.target
Before=openclaw-browser.service

[Service]
Type=simple
WorkingDirectory=/root/ai-auto-advisor
ExecStart=/usr/bin/node scripts/proxy-server.js
Restart=always
RestartSec=5
Environment=HOME=/root

[Install]
WantedBy=multi-user.target
```

## Install order
```bash
# Node 22
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

# Google Chrome (use chromium-browser on Pi instead)
# apt install -y chromium-browser

# OpenClaw
npm install -g openclaw

# App dependencies
cd /root/ai-auto-advisor && npm install

# Copy services
cp deploy/vps-backup/*.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable openclaw-gateway openclaw-browser sam-telegram
systemctl start openclaw-gateway openclaw-browser sam-telegram
```

## Raspberry Pi Notes
- Use `chromium-browser` instead of `google-chrome-stable`
- Pi has a residential IP — you probably DON'T need WARP or any proxy
- Remove `--proxy-server=socks5://127.0.0.1:40000` from browser service
- Chromium path on Pi: `/usr/bin/chromium-browser`
- Pi may need `--disable-dev-shm-usage` and `--no-sandbox` flags too
