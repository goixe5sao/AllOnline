# Tasks: shared board for Claude (architect) and Codex (implementer)

## How we work
- **Claude** owns the architecture: it writes a short design and the tasks here, then reviews the risky diffs. It does not write the code ahead of time.
- **Codex** takes one task at a time. It works out the details from the code itself, implements, runs the checks, then fills in the task's **Result** section.
- One branch per task (`codex/<task-id>`), based on `master`. Do not push to `master`.
- Before you code, read `AGENTS.md`. This Next.js version is different: check `node_modules/next/dist/docs/`.
- Checks before you mark a task done: `npm run lint`, `npx tsc --noEmit`, and the task's own acceptance steps.
- Pitfalls: run only one Next dev server at a time, and use the demo DB, never the live data.
- Mark a task **Risk: high** if it touches auth, payments (SePay/Zalo), the DB schema/migrations, realtime voice/camera, quotas, or deployment. Claude reviews those in depth. Other tasks just need a passing self-check.

## Task template
```
### T-<n>: <title>
Status: todo | doing | review | done   Risk: low | high
Goal: <1–2 lines: the user-visible outcome>
Scope: <files/areas allowed to change>   Out of scope: <…>
Design notes: <only decisions that constrain the solution>
Acceptance: <observable checks>
Result (Codex): <branch, summary, checks run + output, open questions>
```

## Backlog
### T-1: Zalo Bot Platform login (replaces Zalo OA)
Status: review   Risk: high (auth)
Goal: login page "Zalo" tab works through the Zalo Bot (bot.zapps.me). The user sends "DN <code>" to the bot and the page signs in, same flow as the existing OA version (commit c8e4003).
Scope: the server/zalo* bot code, the webhook route, the login page show/hide condition, config (`zaloBot*` in server/config.ts are already added). Out of scope: Zalo OAuth "Đăng nhập bằng Zalo" app login, SePay.
Design notes: Bot API = `https://bot-api.zapps.me/bot<TOKEN>/<method>` (getMe, sendMessage, setWebhook). Verify the webhook by the `X-Bot-Api-Secret-Token` header == ZALO_BOT_WEBHOOK_SECRET, using a constant-time compare. Reuse the existing code-login logic and one-time codes; swap only the transport and verification. Remove the OA-only paths (OA refresh token, OA signature) and keep things compiling. Show the tab only when the token is set. Add a script/admin action that calls setWebhook to `https://sankhau.pro.vn/api/zalo/bot-webhook`. Check the current Zalo Bot docs before coding.
Acceptance: unit tests for the webhook auth (bad/missing secret → 401) and the DN-code flow; the demo "Thử bot Zalo" still works; lint + tsc clean.
Result (Codex):
- Branch: `codex/t-1-zalo-bot` (committed locally; not pushed).
- Summary: replaced OA token refresh/signatures/sender with Bot Platform transport; authenticated `/api/zalo/bot-webhook` with a constant-time secret comparison; adapted private text/image events, preserved DN codes/claims and existing identity storage, gated the production login tab on bot configuration, and kept the demo simulator using captured replies even with inherited credentials. Added explicit dry-run-by-default webhook registration and current setup notes in `docs/ZALO-BOT.md`.
- Docs: checked official getMe/sendMessage/setWebhook/webhook pages before implementation. Current API host is `bot-api.zaloplatforms.com`, superseding the task note's old hostname.
- Link decision: use `getMe.account_name` (`https://zalo.me/bot.JwUidOjZ`), resolved at server startup; never interpolate numeric API id `3431386737049524427`. This is an inference, not a verified Zalo-client result: anonymous probes of both forms redirect to login/app stores. See open questions.
- Checks: PASS `npm.cmd run lint` (exit 0, 0 errors, 16 existing warnings); PASS `npx.cmd tsc --noEmit` (exit 0); PASS `npx.cmd vitest run tests/zalo-bot.test.ts tests/zalo-pay.test.ts --silent` (2 files, 20 tests). Coverage includes missing/bad webhook secret → 401, real HTTP routing without Origin, DN → session cookie, claim isolation/single use/expiry, group/bot exclusion, demo signup + DN account reuse, transport errors, and mocked setWebhook. PASS registration-script dry run with fake process credentials (no outbound registration). PASS `git diff --check`.
- Environment: only in-memory demo PGlite and a temporary loopback API test server; no live DB/API calls, live server/tunnel start/restart, setWebhook against the live bot, or `.env.local` access/edits. Existing unrelated `.gitignore` change left out of commit. Browser E2E was not run because no Next server was started.
- Open questions: verify the selected account-name public link on a device signed into Zalo before rollout; anonymous HTTP responses do not distinguish the two candidates. Claude auth review and a separately authorized deployment/webhook registration remain pending. Bot Platform identities retain the `zalo_oa` storage key but are not automatically linked to old OA follower ids; existing accounts can use LK.
