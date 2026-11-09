#!/usr/bin/env bash
# Runs every bot suite against the local emulators and prints only a summary.
# Usage: bash bots/run-all.sh   (needs Java and firebase-tools; no network)
set -u
cd "$(dirname "$0")/.."
cat > /tmp/pulse-bots-inner.sh <<'INNER'
set -u
npx vitest run --config bots/vitest.config.ts --reporter=dot > bots/out-vitest.log 2>&1; V=$?
VITE_USE_EMULATOR=1 npx vite --port 3000 --host 127.0.0.1 > /tmp/pulse-vite.log 2>&1 &
VP=$!
for i in $(seq 1 60); do curl -s -o /dev/null http://127.0.0.1:3000 && break; sleep 1; done
node bots/e2e/players.mjs; E=$?
kill $VP 2>/dev/null
node bots/ops/members-smoke.mjs; M=$?
npx vite build > /tmp/pulse-build.log 2>&1 && { npx vite preview --port 4173 --host 127.0.0.1 > /tmp/pulse-preview.log 2>&1 & PP=$!; for i in $(seq 1 30); do curl -s -o /dev/null http://127.0.0.1:4173 && break; sleep 1; done; node bots/e2e/installable.mjs; I=$?; kill $PP 2>/dev/null; } || I=1
echo "--- swarm + attack bots ---"; grep -E "Test Files|Tests |FAIL|✗|×" bots/out-vitest.log | head -40
exit $(( V || E || M || I ))
INNER
npx -y firebase-tools@15 emulators:exec --only firestore,auth --project "$(node -p "require('./firebase-applet-config.json').projectId")" "bash /tmp/pulse-bots-inner.sh"
