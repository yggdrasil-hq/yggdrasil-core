#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

copy_env() {
  local example="$1"
  local target="${example%.example}"

  if [[ ! -f "$example" ]]; then
    return 0
  fi

  if [[ -f "$target" ]]; then
    echo "skip (exists): $target"
  else
    cp "$example" "$target"
    echo "created: $target"
  fi
}

echo "Setting up environment files from .env.example ..."

copy_env "$ROOT/deploy/.env.example"
copy_env "$ROOT/api/.env.example"
copy_env "$ROOT/web/.env.example"
copy_env "$ROOT/landing/.env.example"
copy_env "$ROOT/docusaurus/.env.example"
copy_env "$ROOT/orchestrator/.env.example"

echo "Done. Run: docker compose -f deploy/docker-compose.dev.yml up --build"
