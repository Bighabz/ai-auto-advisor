#!/bin/bash
# SAM Pi Setup Script
# Run this on the Raspberry Pi as user 'sam'
# Usage: bash setup-pi.sh

set -e
LOG="[sam-setup]"

echo "$LOG Starting SAM setup on Raspberry Pi..."

# ── 1. System packages ──
echo "$LOG Installing system packages..."
sudo apt-get update -qq
sudo apt-get install -y -qq \
  git \
  curl \
  chromium-browser \
  ca-certificates \
  gnupg \
  2>&1 | tail -5

# ── 2. Node.js 22 ──
echo "$LOG Installing Node.js 22..."
if ! node --version 2>/dev/null | grep -q "v22"; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - 2>&1 | tail -3
  sudo apt-get install -y nodejs 2>&1 | tail -3
fi
echo "$LOG Node: $(node --version)"

# ── 3. OpenClaw ──
echo "$LOG Installing OpenClaw..."
sudo npm install -g openclaw 2>&1 | tail -3
echo "$LOG OpenClaw: $(openclaw --version 2>/dev/null || echo 'installed')"

# ── 4. Clone repo ──
echo "$LOG Cloning SAM repo..."
cd /home/sam
if [ -d "ai-auto-advisor" ]; then
  echo "$LOG Repo already exists, pulling latest..."
  cd ai-auto-advisor && git pull
else
  git clone https://github.com/Bighabz/ai-auto-advisor.git
  cd ai-auto-advisor
fi

# ── 5. Install npm dependencies ──
echo "$LOG Installing npm dependencies..."
npm install 2>&1 | tail -5

# ── 6. Create .env from template ──
echo "$LOG Setting up environment..."
if [ ! -f "config/.env" ]; then
  cp config/.env.example config/.env
  echo "$LOG Created config/.env — you need to fill in your credentials"
else
  echo "$LOG config/.env already exists"
fi

# ── 7. Chromium path (Pi uses chromium-browser, not google-chrome-stable) ──
CHROMIUM_PATH=$(which chromium-browser 2>/dev/null || which chromium 2>/dev/null)
echo "$LOG Chromium at: $CHROMIUM_PATH"
echo "$LOG Chromium: $(chromium-browser --version 2>/dev/null || chromium --version 2>/dev/null)"

# ── 8. Create systemd services ──
echo "$LOG Creating systemd services..."

# openclaw-gateway
sudo tee /etc/systemd/system/openclaw-gateway.service > /dev/null << 'EOF'
[Unit]
Description=OpenClaw Gateway
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/openclaw gateway
Restart=always
RestartSec=5
Environment=HOME=/home/sam
EnvironmentFile=/home/sam/ai-auto-advisor/config/.env
WorkingDirectory=/home/sam/ai-auto-advisor
User=sam

[Install]
WantedBy=multi-user.target
EOF

# openclaw-browser (Pi: no WARP proxy needed — residential IP)
CHROMIUM_BIN=$(which chromium-browser 2>/dev/null || which chromium 2>/dev/null)
sudo tee /etc/systemd/system/openclaw-browser.service > /dev/null << SVCEOF
[Unit]
Description=OpenClaw Browser (Chromium)
After=openclaw-gateway.service
Requires=openclaw-gateway.service

[Service]
Type=simple
ExecStart=${CHROMIUM_BIN} --headless --no-sandbox --disable-gpu --disable-dev-shm-usage --remote-debugging-port=18800 --user-data-dir=/home/sam/.openclaw/browser/openclaw/user-data --no-first-run
Restart=always
RestartSec=5
Environment=HOME=/home/sam
User=sam

[Install]
WantedBy=multi-user.target
SVCEOF

# sam-telegram
sudo tee /etc/systemd/system/sam-telegram.service > /dev/null << 'EOF'
[Unit]
Description=SAM Telegram Bot
After=openclaw-browser.service
Requires=openclaw-browser.service

[Service]
Type=simple
WorkingDirectory=/home/sam/ai-auto-advisor
ExecStart=/usr/bin/node skills/telegram-gateway/scripts/server.js
Restart=always
RestartSec=10
Environment=HOME=/home/sam
EnvironmentFile=/home/sam/ai-auto-advisor/config/.env
User=sam

[Install]
WantedBy=multi-user.target
EOF

# ── 9. Enable and start services ──
echo "$LOG Enabling services..."
sudo systemctl daemon-reload
sudo systemctl enable openclaw-gateway openclaw-browser sam-telegram

echo ""
echo "════════════════════════════════════════════════"
echo "$LOG Setup complete!"
echo ""
echo "NEXT STEP: Fill in your credentials:"
echo "  nano /home/sam/ai-auto-advisor/config/.env"
echo ""
echo "Then start SAM:"
echo "  sudo systemctl start openclaw-gateway"
echo "  sudo systemctl start openclaw-browser"
echo "  sudo systemctl start sam-telegram"
echo ""
echo "Check logs:"
echo "  journalctl -u sam-telegram -f"
echo "════════════════════════════════════════════════"
