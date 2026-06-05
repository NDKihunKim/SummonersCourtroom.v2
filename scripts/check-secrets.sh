#!/usr/bin/env bash
# Check for accidentally-committed secrets before pushing.
# Run manually:  bash scripts/check-secrets.sh
# Automate via:  ln -s ../../scripts/check-secrets.sh .git/hooks/pre-push
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

FOUND=0

echo "==> Checking for secrets in staged and committed files..."

# Patterns that look like live secrets (not placeholders)
PATTERNS=(
  "RGAPI-[a-zA-Z0-9_-]{8,}"           # Riot API key
  "sb_secret_[a-zA-Z0-9_]+"           # Supabase secret key
  "eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+"  # JWT (service role)
  "sk-[a-zA-Z0-9]{32,}"               # AI provider key format
  "SUPABASE_SERVICE_ROLE_KEY=eyJ"     # Service role key assignment
  "SUPABASE_DB_PASSWORD=[^ ]{4,}"     # DB password assignment
  "AI_GATEWAY_TOKEN=[^ ]{8,}"         # AI gateway token assignment
)

for pattern in "${PATTERNS[@]}"; do
  # Search staged changes AND all tracked files (not .env.local which is gitignored)
  MATCHES=$(git grep -n "$pattern" -- ':!.env.local' ':!.env.example' ':!.dev.vars' ':/docs/' 2>/dev/null || true)
  if [ -n "$MATCHES" ]; then
    echo -e "${RED}[FAIL]${NC} Found potential secret matching: $pattern"
    echo "$MATCHES"
    echo ""
    FOUND=1
  fi
done

# Also check staged diff for secrets being added
if git diff --cached --name-only | grep -v '.env.local\|.env.example\|.dev.vars\|docs/' > /dev/null 2>&1; then
  STAGED_SECRETS=$(git diff --cached | grep -nE "RGAPI-[a-zA-Z0-9_-]{8,}|sb_secret_|sk-[a-zA-Z0-9]{32,}|SUPABASE_SERVICE_ROLE_KEY=eyJ" || true)
  if [ -n "$STAGED_SECRETS" ]; then
    echo -e "${RED}[FAIL]${NC} Found potential secret in staged changes"
    echo "$STAGED_SECRETS"
    FOUND=1
  fi
fi

if [ "$FOUND" -eq 0 ]; then
  echo -e "${GREEN}[PASS]${NC} No secrets detected."
  exit 0
else
  echo -e "${RED}[WARN]${NC} Review the matches above. If they are false positives, ignore."
  echo "To bypass this check, run:  git push --no-verify"
  exit 1
fi
