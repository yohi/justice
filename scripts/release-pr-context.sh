#!/usr/bin/env bash
# Collects read-only release PR context for scripts/release-label-resolver.mjs.
# Usage: release-pr-context.sh <pr-number> <output-dir>
# Requires: GH_TOKEN, GITHUB_REPOSITORY, gh, jq, git (full tag history).
set -euo pipefail

pr_number="$1"
out_dir="$2"
[[ "$pr_number" =~ ^[0-9]+$ ]] || { echo "Invalid PR number" >&2; exit 1; }
mkdir -p "$out_dir"

git tag --list 'v[0-9]*' > "$out_dir/tags.txt"
gh api "repos/${GITHUB_REPOSITORY}/issues/${pr_number}" --jq '[.labels[].name]' > "$out_dir/labels.json"
gh api --paginate "repos/${GITHUB_REPOSITORY}/issues/${pr_number}/events" \
  --jq '[.[] | select(.event == "labeled" and .actor != null) | {label: .label.name, actor: .actor.login}]' |
  jq -s 'add // []' > "$out_dir/events.json"

permissions='{}'
while IFS= read -r actor; do
  permission="$(gh api "repos/${GITHUB_REPOSITORY}/collaborators/${actor}/permission" --jq '.permission' 2>/dev/null || echo none)"
  permissions="$(jq -c --arg actor "$actor" --arg permission "$permission" '. + {($actor): $permission}' <<<"$permissions")"
done < <(jq -r '[.[].actor] | unique | .[]' "$out_dir/events.json")
printf '%s\n' "$permissions" > "$out_dir/permissions.json"
