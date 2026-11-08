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
- Review fixes (2026-11-08): nonblocking getMe discovery clears stale botInfo, logs a token-free line on failure and retries every 5 minutes until success; validated webhooks return 200 before background handling with caught failures and documented message.message_id dedupe (process-local, 24h/20,000 entries); private human messages use from.id for identities, chat.id for text/image replies (including immediate payment confirmation), and from.display_name for new accounts; image downloads use a 15s timeout, reject Content-Length over 8 MiB before reading, and enforce the size limit while streaming. Added regression coverage for all four items. PASS lint (0 errors, 16 existing warnings), tsc --noEmit, Zalo tests (2 files, 27 tests), git diff --check. Official webhook docs rechecked; only mocked outbound calls and local in-memory/loopback tests, no live API/DB calls or .env.local access/edits. Committed locally on codex/t-1-zalo-bot; no push.

### T-2: Design-system foundation + UI audit
Status: done   Risk: low (no behaviour change)
Goal: implement docs/DESIGN.md tokens, font, base styles and the `src/components/ui` components, and refactor `app-shell.tsx` and `theme-toggle.tsx` onto them. Add a dev-only `/styleguide` page that shows every component in both themes.
Scope: `src/app/globals.css` (tokens/base only), a new `src/app/ui.css`, `src/components/ui/*`, `app-shell`, the layout font, and `/styleguide`. Out of scope: page-specific redesigns (T-3+), the 3D scenes.
Acceptance: first save "before" screenshots of all 10 pages (390 and 1440, dark) to `docs/screenshots/ui/before/` (demo mode). `/styleguide` renders with no console errors; screenshots of it go in `docs/screenshots/ui/`. Existing pages still render (the old classes keep working until each page is migrated). lint, tsc and the existing tests pass.
Result (Codex, 2026-11-08):
- Branch: `codex/ui-system`; committed locally, no push. Only T-2 implemented.
- Summary: added dark-default theatre tokens, light overrides, legacy colour aliases, type/space/radius/shadow/motion tokens, Be Vietnam Pro (latin + vietnamese; 400/500/600/700) through `next/font/google`, tabular numbers, focus rings and reduced motion. Existing page and 3D styles remain in place. AppShell now uses shared badges, buttons, loading skeleton and login card; ThemeToggle uses Lucide Sun/Moon. `/styleguide` is guarded by `NODE_ENV === development` and demonstrates both themes through the persisted theme toggle.
- Components created in `src/components/ui/index.tsx`, styled in `src/app/ui.css`: Button (four variants, three sizes, icon/loading/disabled), Field (linked label/hint/error), Input, Select, Textarea, Checkbox, RadioCard, Card/Header/Body/Footer, PageHeader, Section, Tabs (arrow/Home/End keys), Stepper, Badge, EmptyState, Skeleton, Toast, Modal/Sheet (native dialog, focus trap/restore, Escape, mobile bottom sheet), DataList (desktop table/mobile cards), Price (VND), StickyActionBar.
- PASS setup: `npm.cmd ci` completed here. Read the installed Next.js font, global CSS, client/server component and notFound guides before implementation. Used one custom dev server on `http://localhost:3100`, `ALLOW_DEMO_MODE=1`, empty database credentials, `MARKET_DATA=off`, and worktree-local `.data-ui-audit`; no `.env.local` needed. Server stopped after checks. No production directory, live DB, ports 3000/3200, deployment or push.
- PASS `npm.cmd run lint`: exit 0, 0 errors, 16 pre-existing warnings. PASS `npx.cmd tsc --noEmit`: exit 0. PASS `npm.cmd test -- --maxWorkers=2`: 16 files, 174 tests. PASS `git diff --check`.
- PASS browser acceptance using the repo's `puppeteer-core` + headless Chrome approach: baseline all ten routes returned 200 with no page/console errors; after migration, eight non-3D routes render at 390/1440 in dark/light (32 combinations), no page/console errors. `/styleguide` at 390×844/1440×900 dark/light returns 200 with no errors. Verified tabs/arrow navigation, checkbox/radio, dialog initial focus/trap/Escape/restoration, theme persistence, reduced motion and no overflow at 360 px. Repeatable script: `node scripts/ui-audit.mjs before|styleguide|verify`; refuses non-demo servers, closes each context before opening the next. `verify` never opens 3D routes.
- PASS contrast calculations for component text: body/secondary on surface >=7.87:1, primary button >=7.02:1 (hover >=5.71:1), status text on 14% soft surfaces >=4.53:1. Intentional design correction: light `--on-accent` uses dark ink because the specified white fails AA; light statuses and link text are darkened. `--text-3` is reserved for non-text decoration such as hover borders in the foundation. This is not a claim that unmigrated page-specific styles are AA compliant.
- Screenshots: `docs/screenshots/ui/before/{login,account,rooms-new,orders,order,admin,join,logs}-{390,1440}-dark.png` (16), plus `before/home-390-dark.png` and `before/room-390-dark.png`. Explicit user safety override: only ONE screenshot for home and ONE for room, immediately closed; their desktop baseline captures and post-change 3D revisits were omitted. `docs/screenshots/ui/styleguide-{390,1440}-{dark,light}.png` (4 full-page captures with the requested viewport sizes) and `styleguide-modal-{390,1440}-{dark,light}.png` (4 viewport captures). Machine-readable evidence: `before/before-report.json`, `styleguide-report.json`, `verify-report.json`.
- UI audit / remaining work: `/rooms/new` already has horizontal overflow at 390 px before this task and still does (KNOWN FAIL, deferred to T-3). It needs the planned shorter step flow and responsive price summary. Login/account/join still use legacy form/layout patterns (T-4); orders/detail still need DataList/payment layout (T-5); admin/logs still need responsive navigation/data presentation (T-6); home/room retain their existing scene and overlays (T-7). These page-specific redesigns were not started. No other audited non-3D route overflowed at 390/1440 in either theme.
- Open questions: designer review of the documented light-theme contrast correction; remaining page-specific accessibility and layout work belongs to T-3–T-7. Production build and full interactive 3D E2E were not run for this foundation task; existing unit/service tests and the bounded demo browser checks above passed.

### T-3: /rooms/new redesign (owner's top complaint)
Status: review   Risk: medium (money/booking form; presentation only)
Goal: a polished create-room flow: a Stepper (1 Room type & stage → 2 Time & size → 3 Extras → 4 Review & pay), radio-cards with thumbnails or icons for stage types, a live price summary card (sticky sidebar on desktop, collapsible bottom summary + StickyActionBar on mobile), and clear validation.
Scope: `src/app/rooms/new/*` and the components it needs. Keep the existing API calls, fields and pricing logic exactly the same. Presentation only.
Acceptance: the same request payloads as before (prove it with a test or e2e capture), after screenshots at 390/1440 in both themes, the existing e2e for room creation passes, lint, tsc.
Result (Codex, 2026-11-08):
- Branch: `codex/ui-system`; committed locally, no push. Four-step create-room flow using Stepper and native RadioCards with Lucide icons for maps/stage styles. All existing fields remain mounted with their values retained between steps; configuration construction, quote debounce, screen normalization, trial duration adjustment, promo and create API bodies stay unchanged. Review shows selected configuration before payment. Desktop price summary sticks within the content grid (so it cannot cover the CTA); mobile total/CTA stays in StickyActionBar with an expandable, scrollable price panel. Slot exhaustion and other blocking errors appear beside the CTA.
- Claude review: compact mobile logo/hamburger with a focus-trapped Sheet; inline desktop links; account menu and theme toggle grouped at right; slim single-line demo banner. RadioCard fieldset/legend use surface, border, radius and text tokens, including `/styleguide`.
- Encoding investigation: decoded UTF-8 scan of every text source under `src/` found zero mojibake occurrences; header renders the API's `displayName`, with JSON already served as UTF-8. The reported name is demo fixture data, not a hardcoded header string. The repeatable audit now creates `Kiểm tra giao dịch` directly from the UTF-8 JavaScript fixture and asserts exact API and rendered-menu text in all four viewport/theme combinations. No blanket decoding of user-provided names was added. `scripts/ui-t3.mjs` also fails on mojibake/replacement characters in source.
- PASS `npm.cmd run lint`: 0 errors, 16 existing warnings. PASS `npx.cmd tsc --noEmit`. PASS `npm.cmd test -- --maxWorkers=2`: 16 files / 174 tests. PASS `git diff --check`.
- PASS existing `node scripts/e2e-create-room.mjs docs/screenshots/ui/after` adapted to navigate steps and select native radio cards, with a corrected stale chart-input selector. Covers capacity/slot errors and recovery, all maps, empty avatar groups, screen validation, waiting ratio, duration prices, open-ended deposit, promo errors/100% discount, trial limits, rapid requotes and session recovery. Real demo API creation succeeds for trial, paid, promo and deposit, with captured payload assertions for every config key and selected options plus persisted custom options. Room-route requests are replaced with a placeholder to avoid mounting 3D scenes. Browser is closed in `finally`.
- PASS `node scripts/ui-t3.mjs`: 16 step captures (four steps × two widths × two themes), no horizontal overflow at 390/1440, no browser errors; exact pre-redesign default create payload asserted in all four combinations, including every field and initial screen. Header/account/mobile navigation Sheets and token fieldset checks pass. Screenshots: `docs/screenshots/ui/after/rooms-new-step-{1,2,3,4}-{390,1440}-{dark,light}.png`, `header-*`, mobile expanded summary, and `styleguide-*`; captured payloads and UTF-8 fixture evidence in `after/t3-report.json`.
- Safety: only this worktree and local demo PGlite (`.data-ui-audit`), one custom demo server on 3100, stopped after checks. No production directory access, live database/payment calls, deployment or push. Open question: Claude visual review; no pricing or booking service changes.

- Claude polish (2026-11-08): renamed Không gian / Nhân vật / Tóm tắt & giá, assigned distinct map icons, limited customer summary to seats, duration, price, discount and total. Internal capacity and rounding details are collapsed under Chi tiết hệ thống for app_owner only. Plain slot exhaustion stays visible to everyone. Mobile reserves measured action height plus safe-area inset. Quote/create payload construction and pricing unchanged.
- Polish checks: PASS lint (0 errors, 16 existing warnings), tsc, 16 test files / 174 tests, ui-t3 (16 step captures in both themes/sizes and exact payload assertions), existing create-room e2e (all checks, including trial/paid/promo/deposit payloads), diff --check. Overwrote after/rooms-new-*; demo server only on 3100, will be stopped after T-4 in this session.

### T-4: Login, account, join/[code]
Status: review   Risk: medium (auth UI; auth logic unchanged)
Goal: a centred auth card with Email/Zalo tabs and the brand header. Zalo tab: a large code, a copy button, an "Mở Zalo" button and a QR on desktop. Account becomes sections in Cards. The invite page becomes an event hero (name, time countdown, host, join CTA, add-to-calendar).
Acceptance: screenshots, the existing e2e for login and join, lint, tsc.

Result (Codex, 2026-11-08):
- Branch: `codex/ui-system`; separate local commit after the T-3 polish; no push.
- Summary: centred branded auth Card, shared keyboard-accessible Email/Zalo Tabs, token Inputs/buttons, account sections with Cards and Badges, invite hero with event name, countdown, host, calendar/share actions and mobile StickyActionBar. Host comes from the existing server invite metadata through a narrow client context; no REST response changes. Existing avatar preview and selection, guest/account identity, password handling, session storage, redirects, reminder and calendar logic remain intact.
- Zalo: bot URL still comes from `/api/catalog` → `zaloBot.url`; code still uses POST `/api/auth/zalo/code` with `{}` and the same claim/poll/expiry flow. Added locally rendered desktop QR with `qrcode.react` 4.2.0 (official API checked), large message, copy feedback and Mở Zalo button. No external QR service or auth-service changes.
- PASS lint (0 errors, 16 existing warnings), `npx.cmd tsc --noEmit`, `npm.cmd test -- --maxWorkers=2 --silent` (16 files / 174 tests), `git diff --check`.
- PASS `node scripts/ui-t4.mjs`: 24 full-page screenshots at 390×844 / 1440×900, dark/light: `after/{login,login-email,login-signup,login-zalo,account,join}-{390,1440}-{dark,light}.png`. Checks overflow, desktop/mobile QR visibility, catalogue bot link, clipboard content, demo sign-in, profile save, host/countdown/calendar and real guest entry. Exact email login/signup payloads verified with browser-only fixtures (no live auth requests); exact guest/join bodies verified against demo API. Evidence: `after/t4-report.json`.
- PASS existing `node scripts/e2e-zalo-code.mjs docs/screenshots/ui/after`: desktop/mobile new-account DN login, wrong/used code rejection, next redirect and repeat login account reuse. Made test identities unique per run so a persistent demo DB does not invalidate the new-account assertion; browser cleanup in finally, home redirect replaced with a placeholder to avoid 3D rendering.
- PASS existing invite acceptance via `node scripts/e2e-engage.mjs docs/screenshots/ui/after --join-only`: server title/share metadata, countdown, saved reminder, calendar ICS, share image, guest entry and stored pass/avatar. Added bounded join-only mode; room navigation uses a placeholder. The unrelated realtime reactions/Q&A/co-host portion of this e2e was not run.
- T-3 checks rerun successfully after the page migration: ui-t3 plus the complete create-room e2e, including customer absence of system details, collapsed admin details, mobile reserved action height and unchanged create payloads.
- Safety: only this worktree, local demo PGlite `.data-ui-audit`, one server on 3100; stopped after checks. No production directory access, live DB/payment/auth calls, deployment or push. Open question: Claude visual review. No backend/auth/pricing implementation changed.

### T-5: Orders list + order detail (payment)
Status: todo (after T-2)   Risk: medium (payments UI only)
Goal: orders as a DataList with status Badges. Order detail is a payment card: a VietQR image, amount and content each with a copy button, a countdown, and a status timeline. Proof upload is a dropzone.
Acceptance: screenshots, the SePay/order e2e, lint, tsc.

### T-6: Admin + room logs
Status: todo (after T-2)   Risk: low
Goal: an admin layout with a side nav on desktop and tabs on mobile, KPI tiles, DataLists and consistent forms. Room logs become a filterable timeline.
Acceptance: screenshots, lint, tsc.

### T-7: Home page + in-room HTML overlays
Status: todo (last)   Risk: high (3D performance, the core experience)
Goal: overlays (toolbars, orb, panels, dialogs, chat) use the tokens and components. The home lobby text and CTAs get the same polish. The 3D scene itself is not changed.
Acceptance: screenshots taken carefully (see DESIGN.md), no frame-rate regression, the existing room e2e passes.
