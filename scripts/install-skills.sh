#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "==> Installing approved external agent skills"
echo "Project: $ROOT_DIR"
echo

command -v node >/dev/null 2>&1 || { echo "ERROR: Node.js is required."; exit 1; }
command -v npx >/dev/null 2>&1 || { echo "ERROR: npx is required."; exit 1; }

install_skill() {
  local repo="$1"
  local skill="$2"
  echo "------------------------------------------------------------"
  echo "Installing: $skill"
  echo "Source:     $repo"
  npx --yes skills add "$repo" --skill "$skill"
}

install_skill "https://github.com/anthropics/skills" "frontend-design"
install_skill "https://github.com/vercel-labs/agent-skills" "vercel-react-best-practices"
install_skill "https://github.com/vercel-labs/agent-skills" "web-design-guidelines"
install_skill "https://github.com/vercel-labs/agent-skills" "vercel-composition-patterns"
install_skill "https://github.com/supabase/agent-skills" "supabase-postgres-best-practices"
install_skill "https://github.com/mattpocock/skills" "domain-modeling"
install_skill "https://github.com/mattpocock/skills" "tdd"
install_skill "https://github.com/mattpocock/skills" "code-review"
install_skill "https://github.com/mattpocock/skills" "diagnosing-bugs"

echo
echo "==> Installed skills:"
if [ -d ".agents/skills" ]; then
  find .agents/skills -maxdepth 2 -name SKILL.md -print | sort
else
  echo "WARNING: .agents/skills was not created."
fi

echo
echo "Done."
echo "To update installed skills later, run:"
echo "  npx skills update"
