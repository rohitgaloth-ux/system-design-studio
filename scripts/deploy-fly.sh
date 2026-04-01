#!/usr/bin/env bash
# Deploy from YOUR machine only. API keys live in Fly "secrets", not in Git or the Docker image.
# Prerequisites: flyctl installed (`brew install flyctl`), `fly auth login`, DATABASE_URL + other secrets set.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v fly >/dev/null 2>&1; then
  echo "Install Fly: brew install flyctl  (or https://fly.io/docs/hands-on/install-flyctl/)"
  exit 1
fi

echo "== Checking secrets (set these once; they are NOT read from .env on the server) =="
echo "Run if you have not yet:"
echo "  fly secrets set \\"
echo "    DATABASE_URL=\"postgresql://...\" \\"
echo "    JWT_SECRET=\"\$(openssl rand -hex 48)\" \\"
echo "    GEMINI_API_KEY=\"paste-key-here\" \\"
echo "    ALLOWED_ORIGIN=\"https://YOUR-APP.fly.dev\" \\"
echo "    TRUST_PROXY=1 \\"
echo "    APP_PUBLIC_URL=\"https://YOUR-APP.fly.dev\""
echo ""
echo "Optional (password-reset email): RESEND_API_KEY, EMAIL_FROM — or SMTP_* vars."
echo ""
read -r -p "Press Enter to deploy (or Ctrl+C to set secrets first)..."

fly deploy

echo "Done. Open your app URL from: fly apps open  (or the hostname in fly.toml / dashboard)"
