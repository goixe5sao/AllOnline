# U-2 result — 2026-11-13

Branch/worktree: `codex/stockvn-link`, `/home/cuong/work/AllOnline-stockvnlink`.

Implementation is complete locally. Full-suite verification and both requested commits are
blocked by sandbox restrictions; this is not a claim that all required checks passed.

## What changed

- Surveyed AGENTS.md, docs/TASKS.md (including U-2), the read-only StockVN
  U-1 link endpoint contract, bot.ts, db.ts, identities.ts, zalo-bot.test.ts,
  account/page.tsx and the installed Next.js use-client guide.
- server/zalo/bot.ts: SV/STOCKVN parsing, accent/case normalization, strict
  six-character A–Z/2–9 codes, existing-account requirement, per-account
  five-minute confirmation, CÓ/KHÔNG, cancellation, expiry and replacement.
  Confirmations are consumed before HTTP; repeated confirmations do not reuse them.
  Existing DN/LK commands retain their behavior. Help includes SV.
- server/config.ts: server-only STOCKVN_BASE_URL (default
  http://127.0.0.1:3200) and SANKHAU_LINK_SECRET.
- server/db.ts: idempotent app.stockvn_links creation through migrate(),
  with unique user_id, account foreign key/cascade, stockvn_user_id and linked_at.
- Confirmation posts the contracted bearer/body with a 10-second timeout.
  Exact 200/404/409/429/fallback replies; validated 200 IDs are upserted.
  Missing configuration is reported and logged without sending HTTP.
  Errors are logged without secrets, codes or raw response bodies.
- server/zalo/routes.ts: authenticated /api/me/identities exposes stockvnLinked
  for the requesting account only.
- src/app/account/page.tsx: “Đã liên kết StockVN” badge when that field is true.
- docs/ZALO-BOT.md: configuration, command and pending-confirmation behavior.
- tests/stockvn-link.test.ts: 10 tests in the existing Vitest/PGlite/CaptureSender
  style, covering parsing, help, unknown sender, confirmation, cancellation,
  expiry, replacement, isolation, repeated confirmation, persistence/upsert,
  per-account route status, every specified HTTP outcome, default/custom URL,
  bearer/body, timeout signal, timeout failure, missing config and malformed 200.
  This separate file runs without opening sockets; the existing HTTP suites are unchanged.
- tests/stock-alerts.test.ts: pinned one existing test's fixture provider to its
  fixed November 9 clock. It previously compared today's fixtures with a fixed
  historical tick, producing zero alerts instead of one. No service behavior changed.

The pre-existing docs/TASKS.md edit was preserved and excluded from the attempted commit.

## Checks

- PASS: npm run lint — exit 0, 0 errors, 13 existing warnings.
- PASS: npm run typecheck — exit 0 (tsc --noEmit).
- PASS: npm test -- tests/stockvn-link.test.ts --maxWorkers=1 --silent —
  1 file, 10 tests passed, exit 0.
- PASS: git diff --check.
- BLOCKED: npm test -- --maxWorkers=1 --silent — exit 1:
  18 files passed, 2 failed; 192 tests passed, 36 skipped, 2 errors.
  The two suites are tests/zalo-bot.test.ts and tests/ai-plan.test.ts.
  Both existing beforeAll hooks open loopback HTTP listeners and fail with
  “listen EPERM: operation not permitted 127.0.0.1”, followed by setup timeouts.
  This run began before U-2 tests were moved into their separate socket-free file;
  its skipped count includes those tests, which passed separately afterward.
  A minimal node:net loopback listener independently reproduced EPERM.
  Earlier overlapping runs were stopped; no passing full-suite result is claimed.
- No browser audit or deployment was performed. No /srv access, real Zalo or
  StockVN request, push, or changes to the other repository.

## Commits and remaining work

The implementation commit was attempted with explicit file paths, excluding TASKS.md.
Git failed before staging:

    fatal: Unable to create '/home/cuong/work/AllOnline/.git/worktrees/AllOnline-stockvnlink/index.lock': Read-only file system

The worktree's common Git directory is outside the permitted writable roots.
Approval is unavailable in this session. Consequently neither the implementation
commit nor the requested subsequent result-document commit could be created.
The result-document commit was also attempted and hit the same restriction.

In an environment with writable Git metadata and loopback listeners permitted:
run the full test suite, then commit implementation files first and this result
document second, updating this report with the final test output and commit IDs.

## Open questions / limitations

- No unresolved contract question. Interoperability is checked against the supplied
  contract and fake fetch, not a running StockVN service.
- Pending confirmations are process-local and disappear on restart, as permitted.
- A lost response or local DB failure after StockVN consumes the code can leave
  the local badge absent. No automatic retry or reconciliation endpoint is part
  of the supplied contract; this report does not claim cross-service atomicity.
- Auth/schema changes remain appropriate for the task board's high-risk review.
