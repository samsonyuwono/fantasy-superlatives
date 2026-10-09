#!/usr/bin/env bash
# Last-resort email to OWNER_ALERT_EMAIL when a workflow fails before its own script could alert
# (e.g. `npm ci` failing). Plain bash and curl, so it works even when Node never got installed.
#
# Usage: bash .github/scripts/send-crash-alert.sh "<subject>" "<message>"
# Needs RESEND_API_KEY and OWNER_ALERT_EMAIL; EMAIL_FROM is optional. The link to the run is
# appended to the message from GitHub's built-in GITHUB_SERVER_URL, GITHUB_REPOSITORY and GITHUB_RUN_ID.
set -euo pipefail

subject="$1"
message="$2"
run_url="${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"

curl -sS -X POST https://api.resend.com/emails \
  -H "Authorization: Bearer $RESEND_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$(jq -n \
    --arg from "${EMAIL_FROM:-onboarding@resend.dev}" \
    --arg to "$OWNER_ALERT_EMAIL" \
    --arg subject "$subject" \
    --arg text "$message"$'\n'"$run_url" \
    '{from:$from, to:$to, subject:$subject, text:$text}')"
