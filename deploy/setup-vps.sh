#!/bin/bash
# ============================================================
# SAM VPS Setup Script
# Run on a fresh Ubuntu 22.04 droplet as root
# Usage: curl -sL <raw-url> | bash
#   or:  scp setup-vps.sh root@<ip>:~ && ssh root@<ip> bash setup-vps.sh
# ============================================================

set -euo pipefail

echo "═══════════════════════════════════════════════════════════"
echo "  SAM — VPS Setup (Ubuntu 22.04)"
echo "═══════════════════════════════════════════════════════════"

# --- 1. System Updates ---
echo "[1/7] Updating system..."
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq curl git build-essential unzip jq

# --- 2. Node.js 20 LTS ---
echo "[2/7] Installing Node.js 20..."
if ! command -v node &> /dev/null || [[ $(node -v | cut -d. -f1 | tr -d v) -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
fi
echo "  Node: $(node -v)  NPM: $(npm -v)"

# --- 3. Chromium (headless) ---
echo "[3/7] Installing Chromium..."
apt-get install -y -qq chromium-browser || apt-get install -y -qq chromium
echo "  Chromium: $(chromium-browser --version 2>/dev/null || chromium --version 2>/dev/null || echo 'installed')"

# --- 4. Create sam user ---
echo "[4/7] Creating sam user..."
if ! id -u sam &>/dev/null; then
  useradd -m -s /bin/bash sam
  echo "  Created user: sam"
else
  echo "  User sam already exists"
fi

# --- 5. Clone and install SAM ---
echo "[5/7] Cloning SAM repository..."
SAM_DIR="/home/sam/ai-auto-advisor"
if [ -d "$SAM_DIR" ]; then
  echo "  Repo exists — pulling latest..."
  cd "$SAM_DIR" && git pull
else
  cd /home/sam
  git clone https://github.com/Bighabz/ai-auto-advisor.git
fi

cd "$SAM_DIR"
echo "  Installing npm dependencies..."
npm install --production 2>&1 | tail -3
chown -R sam:sam "$SAM_DIR"
echo "  Dependencies installed"

# --- 6. OpenClaw ---
echo "[6/7] Installing OpenClaw..."
if ! command -v openclaw &> /dev/null; then
  # Install OpenClaw framework
  npm install -g openclaw 2>/dev/null || echo "  OpenClaw not available via npm — install manually"
fi

# Initialize OpenClaw workspace
if [ -d "/home/sam/.openclaw" ]; then
  echo "  OpenClaw workspace exists"
else
  su - sam -c "openclaw init 2>/dev/null" || echo "  OpenClaw init skipped — configure manually"
fi

# --- 7. Firewall ---
echo "[7/7] Configuring firewall..."
ufw allow 22/tcp   # SSH
ufw allow 443/tcp  # HTTPS
ufw allow 80/tcp   # HTTP (for cert provisioning)
ufw --force enable
echo "  Firewall: SSH(22) + HTTP(80) + HTTPS(443)"

# --- Done ---
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  VPS Setup Complete!"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "  Next steps:"
echo "  1. Copy your .env file:"
echo "     scp config/.env root@<IP>:$SAM_DIR/config/.env"
echo ""
echo "  2. Add platform credentials to .env"
echo ""
echo "  3. Test the pipeline:"
echo "     ssh root@<IP> 'cd $SAM_DIR && su sam -c \"node scripts/test-e2e.js\"'"
echo ""
echo "  4. Configure OpenClaw gateway for WhatsApp"
echo ""
