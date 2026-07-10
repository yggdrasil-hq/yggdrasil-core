#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

copy_env() {
  local example="$1"
  local target="${example%.example}"

  if [[ ! -f "$example" ]]; then
    return 0
  fi

  if [[ ! -f "$target" ]]; then
    cp "$example" "$target"
    echo "created: $target"
    return 0
  fi

  local added=0
  while IFS= read -r line; do
    # Skip empty lines and comments
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    # Extract variable name (strip optional 'export' prefix, take everything before '=')
    local stripped="${line#export }"
    local key="${stripped%%=*}"
    [[ -z "$key" ]] && continue
    # Append to target if the variable is missing
    if ! grep -qE "^(export[[:space:]]+)?${key}=" "$target" 2>/dev/null; then
      [[ $added -eq 0 ]] && echo "" >> "$target"
      echo "$line" >> "$target"
      echo "  + $key"
      added=$((added + 1))
    fi
  done < "$example"

  if [[ $added -eq 0 ]]; then
    echo "up to date: $target"
  else
    echo "updated ($added added): $target"
  fi
}

generate_secret_key() {
  local target="$1"
  local key="$2"

  [[ -f "$target" ]] || return 0

  # Only fill in the key if it's present but empty (leave any existing value alone)
  if ! grep -qE "^${key}=$" "$target" 2>/dev/null; then
    return 0
  fi

  local value
  value="$(openssl rand -base64 32)"
  local escaped_value="${value//\\/\\\\}"
  escaped_value="${escaped_value//&/\\&}"
  sed -i.bak "s|^${key}=\$|${key}=${escaped_value}|" "$target" && rm -f "$target.bak"
  echo "  + generated $key"
}

echo "Setting up environment files from .env.example ..."

copy_env "$ROOT/deploy/.env.example"
copy_env "$ROOT/api/.env.example"
copy_env "$ROOT/web/.env.example"
copy_env "$ROOT/landing/.env.example"
copy_env "$ROOT/docusaurus/.env.example"
copy_env "$ROOT/orchestrator/.env.example"

generate_secret_key "$ROOT/api/.env" "SECRETS_ENCRYPTION_KEY"

echo "Done. Run: docker compose -f deploy/docker-compose.dev.yml up --build"
