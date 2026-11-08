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
Status: todo (waiting for the bot token)   Risk: high (auth)
Goal: login page "Zalo" tab works through the Zalo Bot (bot.zapps.me). The user sends "DN <code>" to the bot and the page signs in, same flow as the existing OA version (commit c8e4003).
Scope: the server/zalo* bot code, the webhook route, the login page show/hide condition, config (`zaloBot*` in server/config.ts are already added). Out of scope: Zalo OAuth "Đăng nhập bằng Zalo" app login, SePay.
Design notes: Bot API = `https://bot-api.zapps.me/bot<TOKEN>/<method>` (getMe, sendMessage, setWebhook). Verify the webhook by the `X-Bot-Api-Secret-Token` header == ZALO_BOT_WEBHOOK_SECRET, using a constant-time compare. Reuse the existing code-login logic and one-time codes; swap only the transport and verification. Remove the OA-only paths (OA refresh token, OA signature) and keep things compiling. Show the tab only when the token is set. Add a script/admin action that calls setWebhook to `https://sankhau.pro.vn/api/zalo/bot-webhook`. Check the current Zalo Bot docs before coding.
Acceptance: unit tests for the webhook auth (bad/missing secret → 401) and the DN-code flow; the demo "Thử bot Zalo" still works; lint + tsc clean.
Result (Codex):
