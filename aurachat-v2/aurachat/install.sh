#!/usr/bin/env bash
# AuraChat one-command installer (Debian/Ubuntu/RHEL-family VPS, run as root)
#
#   bash <(curl -fsSL https://raw.githubusercontent.com/ominusfgas7-bit/aurachat/main/install.sh)
#
# Non-interactive (skip prompts):
#   ANTHROPIC_API_KEY=sk-ant-... OPENROUTER_API_KEY=sk-or-... ADMIN_PASSWORD=secret PORT=3000 \
#     bash <(curl -fsSL https://raw.githubusercontent.com/ominusfgas7-bit/aurachat/main/install.sh)
# Re-running updates the app (git pull) and keeps your .env and chat data.

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/ominusfgas7-bit/aurachat.git}"
BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/aurachat}"
SERVICE="aurachat"

c_ok() { printf '\033[32m✔ %s\033[0m\n' "$*"; }
c_info() { printf '\033[36m➜ %s\033[0m\n' "$*"; }
die() { printf '\033[31m✘ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run as root (try: sudo -i)"
command -v systemctl >/dev/null || die "systemd is required"

# Read prompts from the terminal even when piped through curl
ask() { # ask VAR "Prompt" [secret]
  local var="$1" prompt="$2" secret="${3:-}" val=""
  if [ -n "${!var:-}" ]; then return; fi
  if [ -r /dev/tty ]; then
    if [ -n "$secret" ]; then read -r -s -p "$prompt" val </dev/tty; echo; else read -r -p "$prompt" val </dev/tty; fi
  fi
  printf -v "$var" '%s' "$val"
}

# ---- system packages ----
c_info "Installing system packages…"
if command -v apt-get >/dev/null; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y >/dev/null
  apt-get install -y git curl ca-certificates build-essential python3 >/dev/null
elif command -v dnf >/dev/null; then
  dnf install -y git curl ca-certificates gcc-c++ make python3 >/dev/null
elif command -v yum >/dev/null; then
  yum install -y git curl ca-certificates gcc-c++ make python3 >/dev/null
else
  die "Unsupported distro (need apt, dnf or yum)"
fi
c_ok "System packages ready"

# ---- Node.js 20 ----
need_node=1
if command -v node >/dev/null; then
  major="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$major" -ge 18 ] && need_node=0
fi
if [ "$need_node" -eq 1 ]; then
  c_info "Installing Node.js 20…"
  if command -v apt-get >/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
    apt-get install -y nodejs >/dev/null
  else
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - >/dev/null
    (dnf install -y nodejs || yum install -y nodejs) >/dev/null
  fi
fi
c_ok "Node $(node -v)"

# ---- fetch code ----
if [ -d "$APP_DIR/.git" ]; then
  c_info "Updating existing install…"
  git -C "$APP_DIR" fetch --quiet origin "$BRANCH"
  git -C "$APP_DIR" reset --hard "origin/$BRANCH" --quiet
else
  c_info "Cloning $REPO_URL…"
  git clone --quiet --depth 1 --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"
c_info "Installing npm dependencies…"
npm install --omit=dev --no-audit --no-fund >/dev/null
c_ok "Dependencies installed"

# ---- config (.env) ----
if [ ! -f .env ]; then
  ask ADMIN_PASSWORD "Choose a login password for the site: " secret
  if [ -z "${ADMIN_PASSWORD:-}" ]; then
    ADMIN_PASSWORD="$(head -c 12 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 14)"
    GENERATED_PW=1
  fi
  echo "   (API keys / gateway can be set later in the website: Settings → API & Providers. Press Enter to skip.)"
  ask ANTHROPIC_API_KEY "Anthropic API key (sk-ant-…, Enter to skip): " secret
  ask OPENROUTER_API_KEY "OpenRouter API key (sk-or-…, Enter to skip): " secret
  ask PORT "Port [3000]: "
  PORT="${PORT:-3000}"
  case "$PORT" in (*[!0-9]*|"") PORT=3000;; esac
  [ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ] || { echo "Invalid port, using 3000"; PORT=3000; }
  # single-quote values so characters like ! $ & # are safe; escape any ' inside
  q() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }
  umask 077
  {
    echo "PORT=${PORT}"
    echo "ADMIN_PASSWORD=$(q "$ADMIN_PASSWORD")"
    echo "ANTHROPIC_API_KEY=$(q "${ANTHROPIC_API_KEY:-}")"
    echo "OPENROUTER_API_KEY=$(q "${OPENROUTER_API_KEY:-}")"
    echo "DEFAULT_MODEL=anthropic:claude-sonnet-4-5"
  } > .env
  c_ok "Created .env"
else
  c_ok "Keeping existing .env"
fi
set -a; . ./.env; set +a

# ---- systemd ----
cat > "/etc/systemd/system/${SERVICE}.service" <<EOF
[Unit]
Description=AuraChat
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
ExecStart=$(command -v node) ${APP_DIR}/server.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null 2>&1
systemctl restart "$SERVICE"
sleep 2
systemctl is-active --quiet "$SERVICE" || { journalctl -u "$SERVICE" -n 30 --no-pager; die "Service failed to start"; }

# open firewall port if ufw/firewalld is active
if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then ufw allow "${PORT:-3000}/tcp" >/dev/null; fi
if command -v firewall-cmd >/dev/null && firewall-cmd --state >/dev/null 2>&1; then
  firewall-cmd --permanent --add-port="${PORT:-3000}/tcp" >/dev/null && firewall-cmd --reload >/dev/null
fi

IP="$(curl -fsS -m 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
echo
c_ok "AuraChat is running!"
echo "   URL:       http://${IP}:${PORT:-3000}"
[ -n "${GENERATED_PW:-}" ] && echo "   Password:  ${ADMIN_PASSWORD}   (generated, change it in ${APP_DIR}/.env)"
echo "   Config:    ${APP_DIR}/.env   (then: systemctl restart ${SERVICE})"
echo "   Logs:      journalctl -u ${SERVICE} -f"
echo "   Update:    re-run this same install command"
echo "   Tip: put it behind Cloudflare Tunnel / Caddy for HTTPS."
