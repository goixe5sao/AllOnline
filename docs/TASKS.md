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
### A-3 (AllOnline): consume the real StockVN scan
Status: done   Risk: low (scan adapter and presentation; no live service enablement)
Goal: accept StockVN's real scan and display historical percentages only for upstream-validated signals carrying stats.
Scope: scan schema/provider, commentary guard, presenter/list, component evidence and tests. No live Zalo/Claude/StockVN calls, deployment or push.
Design notes: owner decision 2026-11-09: StockVN alone supplies validation/evidence. PASS denotes its 80% gate; EVIDENCE denotes significance against its own base rate. AllOnline never computes statistics. Preserve levels/type without stats; display `Lịch sử: {hitRate}% · nền {baseRate}% · {n} lần · {horizon} phiên` when supplied, plus `Đạt chuẩn 80%` only for PASS. An absent baseRate is omitted rather than fabricated.
Acceptance: real sample and improved payload mapping, nullable levels, timestamp overlays, no percentage without stats in UI/commentary, PASS/EVIDENCE rendering, 390/1440 component screenshots, lint/typecheck/tests, local commit.
Result (Codex, 2026-11-09):
- Branch/worktree: `codex/ai-stock`, `D:/ActiveProject/AllOnline-ui`; committed locally, no push.
- Adapter: maps `items` and `method` to picks/types, normalizes offset/Z asOf, scalar/null support/resistance to arrays, preserves nullable equilibrium/value-area and signal levels. Uses numeric upstream score/rank when available; otherwise score follows payload order, rank defaults to one-based order. Mixed/empty directions are neutral. Legacy object scores are not treated as probabilities. Missing legacy dataDelayMin defaults to 0; improved payload delay is preserved.
- Geometry: accepts timed points and boundaries and known internal line/zone/pattern shapes; safely drops unknown and legacy index-only shapes. No bar-index-to-time invention. Vietnamese method labels cover the sample families and common patterns/candles. Null chart levels/value-area are skipped.
- Evidence: optional upstream stats with required PASS/EVIDENCE tier, optional baseRate/outcome/avgReturnPct. Presenter removes price-change percentages and standalone CI percentage copy; history line and PASS badge require stats. Missing baseRate is omitted. Commentary allows percent values only from stats/baseRate of signals with stats, rejecting percentages borrowed from price, score, sample count or other input numbers. Prompt repeats the restriction; deterministic fallback contains no percentages.
- Fixture: all synthetic prices remain visibly labelled sample data; only one explicitly synthetic EVIDENCE example remains, exposed by FixtureScanProvider only with demo enabled. Non-demo fixture scans strip all stats/baseRate. Demo room selection explicitly opts into the sample.
- PASS `npm.cmd run lint`: 0 errors, 13 existing warnings. PASS `npx.cmd tsc --noEmit`. PASS `npm.cmd test -- --maxWorkers=2 --silent`: 19 files / 211 tests. PASS focused scan suites: 2 files / 15 tests. PASS `git diff --check`. Tests use mocked outbound HTTP/SDK and local data only.
- PASS `node scripts/ui-ai-stock-real.mjs`: real presenter/list, no Canvas/Three scene, no page errors or horizontal overflow, 390/1440 dark/light. Checks no percentage without stats and correct PASS/EVIDENCE copy. Four full-page screenshots: `docs/screenshots/ui/after/ai-stock-real-{390,1440}-{dark,light}.png`; report: `ai-stock-real-report.json`. Screenshot evidence examples are explicitly labelled synthetic separately from the supplied real payload. Visually inspected mobile dark output. Updated the previous component harness to expect the new history copy.
- Safety: only this worktree, worktree-local `.data-a3` demo PGlite, credentials disabled and market scheduler off. One demo server on 3100, stopped and confirmed no listener. Temporary launcher/audit route removed. No access to the live project directory, no live Zalo/Claude/StockVN calls, no push. Real service interoperability is validated against the supplied payload and mocks; live endpoint availability is not claimed.

### T-1: Zalo Bot Platform login (replaces Zalo OA)
Status: done (live, owner logged in via the bot on 2026-11-08)   Risk: high (auth)
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
Status: review   Risk: medium (payments UI only)
Goal: orders as a DataList with status Badges. Order detail is a payment card: a VietQR image, amount and content each with a copy button, a countdown, and a status timeline. Proof upload is a dropzone.
Acceptance: screenshots, the SePay/order e2e, lint, tsc.

Result (Codex, 2026-11-08):
- Branch: `codex/ui-system`; separate local T-5 commit, no push. Orders use DataList, status Badges, loading Skeleton and an empty-state creation link. Payment detail uses token cards, unchanged VietQR source, amount/content copy buttons, existing countdown and a status timeline.
- Preserved `/api/orders/:id` polling at 4000 ms, cancel/demo-pay bodies and all backend/payment/pricing code. There is no browser proof-upload control in the existing order page: proofs arrive through the Zalo bot. That behavior is unchanged; adding a dropzone would introduce a new upload path outside this presentation scope.
- PASS lint (0 errors, 16 existing warnings), tsc --noEmit, unit/service tests (16 files / 174 tests), git diff --check. PASS existing e2e-sepay: QR bank/amount/content, unauthorized/irrelevant transfers, partial payment and remaining-amount QR, top-up, automatic status polling, replay and refund review; no browser errors.
- PASS `node scripts/ui-t5-t6.mjs`: orders/detail at 390/1440 dark/light, no overflow or page errors, exact QR source and both clipboard values. Eight captures `after/{orders,order}-{390,1440}-{dark,light}.png`, SePay state captures and `after/t5-report.json`. Visually inspected mobile light payment capture.
- Safety: demo PGlite only, port 3100 only; server stopped at end of session. No production directory, live payment calls, backend edits or push. Claude visual review pending.

### T-6: Admin + room logs
Status: review   Risk: low
Goal: an admin layout with a side nav on desktop and tabs on mobile, KPI tiles, DataLists and consistent forms. Room logs become a filterable timeline.
Acceptance: screenshots, lint, tsc.

Result (Codex, 2026-11-08):
- Branch: `codex/ui-system`; separate local T-6 commit, no push. Admin uses desktop side navigation, wrapping mobile tabs with arrow/Home/End navigation, KPI tiles, token surfaces/forms and responsive shared DataLists. The small AdminDataList adapter retains existing cell content and action handlers. Room logs use an event-type filter, text search, empty state and timeline; raw event JSON is expandable. Order log data uses DataList.
- PASS `node scripts/ui-admin-payloads.mjs`: TypeScript AST comparison against the pre-T6 commit proves all existing admin API calls and onClick/onChange/onBlur/onSubmit handlers unchanged; the complete SettingsForm setup, normalization and save functions before JSX also match, apart from line endings. Evidence: `after/t6-payload-report.json`. No server or pricing implementation changed.
- PASS lint (0 errors, 16 existing warnings), tsc --noEmit, unit/service tests (16 files / 174 tests), git diff --check. PASS existing `e2e-zalo.mjs`: bot signup/single-use login, account link, order lookup, SePay payment, proof file upload, review and admin approval; no page errors. Updated a stale checkmark assertion to the T-4 Badge label, added browser cleanup in finally and placeholder navigation for 3D destinations.
- PASS `node scripts/ui-t5-t6.mjs --admin`: overview, all six other admin tabs and room logs at 390/1440 dark/light, no overflow/page errors; tab keyboard navigation, timeline search-empty state and type filter verified. Captures `after/admin-*`, `after/logs-*`, `after/admin-proofs.png`; `after/t6-report.json`. Extra viewport-only overview captures aid review of the long demo room list. Visually inspected mobile timeline.
- Review nits verified with `ui-t4.mjs`: no header wrapping/overflow; calendar menu links, fallback share/copy/Facebook and mocked native share all pass in four size/theme combinations. Refreshed join/login evidence and open-menu captures.
- Safety: only this worktree and local demo PGlite; demo server on 3100 stopped after final checks. No access to production directory, live API/payment calls, backend changes, deployment or push. Claude visual review pending.

- Polish (2026-11-08): Claude review polish on `codex/ui-system`, one local commit, no push. Consolidated payment fields into one compact five-row bank-details list with accessible copy controls for account, amount and content; customer countdown/status use plain giữ chỗ wording, with quote/slot internals collapsed for app_owner only. Kept the primary action prominent and aligned a quiet danger/ghost Huỷ đơn beside it. Admin now has one eight-tile CSS grid (four desktop columns, two tablet/mobile, one below 380 px), equal row heights and zero sibling offsets; side nav uses plain items with a soft active background/accent bar. Removed admin/order emoji decoration, normalized PageHeader spacing and card padding (24 px desktop / 16 px mobile), and moved invite image colours onto named design tokens. PASS `ui-t5-t6.mjs` and `ui-t5-t6.mjs --admin` (clipboard, customer/owner visibility, action alignment, KPI alignment, tabs/log filters, no overflow/browser errors); PASS `ui-t4.mjs`, `ui-t3.mjs`, admin handler/payload AST comparison, share-image PNG render, lint (0 errors, 16 existing warnings), tsc, tests (16 files / 174 tests), diff --check. Refreshed after screenshots/reports in both themes at 390/1440 and visually checked mobile payment and desktop overview. Presentation only; demo PGlite in this worktree, port 3100 only, stopped after checks; no production directory access, live services, backend edits or push.

### T-7: Home page + in-room HTML overlays
Status: todo (last)   Risk: high (3D performance, the core experience)
Goal: overlays (toolbars, orb, panels, dialogs, chat) use the tokens and components. The home lobby text and CTAs get the same polish. The 3D scene itself is not changed.
Acceptance: screenshots taken carefully (see DESIGN.md), no frame-rate regression, the existing room e2e passes.

### T-8: Host control panel ("Điều khiển chủ phòng") cleanup
Status: review   Risk: medium (in-room UI, realtime screen state)
Goal (owner request 2026-11-08): the content-type list is redundant and confusing. **Remove the TradingView options from the picker.** Keep a single chart option, **"Biểu đồ VN-Index"**, fixed to VNINDEX (no symbol input). Final list: Văn bản, Hình ảnh, Video YouTube, Trang web, Âm thanh, Biểu đồ VN-Index, Màn hình trống. Use short labels with a one-line hint below for the chosen type (e.g. "https hoặc tải lên"), and preferably an icon grid (RadioCards) instead of a native select.
Also: the tabs (Màn hình / Live / Bình chọn / Người tham dự…) overflow with a visible scrollbar, so use a compact scrollable Tabs without a scrollbar, or an icon+label layout that fits at 390 px. Replace the emoji buttons with lucide icons. Use accent/neutral tokens instead of the green fills. "Đang chiếu: image" shows a raw value, so map it to the Vietnamese type name. Use the design-system components (docs/DESIGN.md).
Compat: rooms whose screen is already 'tradingview' (or a non-VNINDEX symbol) must still render. Show them as-is and let the host switch away. Do not change the server realtime protocol unless required, and if it is, keep it backward compatible.
Acceptance: screenshots of the panel at 390/1440 in dark and light (open the room once, close right away; see DESIGN.md), the existing room/screen e2e, lint, tsc, tests.

Result (Codex, 2026-11-08):
- Branch: `codex/host-panel`; local commit, no push. Replaced the content select with seven icon RadioCards and a short selected-type hint. Removed TradingView and symbol inputs from this picker; every newly submitted chart uses `VNINDEX`, retaining the existing interval/type/indicator/layer fields. Existing TradingView and other-symbol renderers, stored state, schemas and realtime protocol are unchanged. Status labels include Vietnamese names and the existing legacy symbol; hosts can switch away without rewriting the current screen on mount.
- Shared Tabs now supply keyboard navigation and linked tab panels; the tab strip scrolls without a visible scrollbar. Scoped host-panel styles use accent/neutral theme tokens, larger mobile panel space and 44 px controls. Replaced stage, playback, close, YouTube playlist and web refresh glyphs with Lucide icons. Fixed intrinsic file-input overflow at 360 px. Updated existing browser scripts to select the new radio inputs; the old arbitrary-stock picker browser script now checks fixed VNINDEX and has a CPU-safe `--component` mode.
- PASS `npm.cmd run lint`: exit 0, 0 errors, 13 existing warnings (three unused imports removed with the obsolete picker script). PASS `npx.cmd tsc --noEmit`: exit 0. PASS `npm.cmd test -- --maxWorkers=2 --silent`: 16 files / 174 tests. PASS focused YouTube/web tests after icon changes: 2 files / 16 tests. PASS `git diff --check`.
- PASS existing room/screen E2E: `$env:BASE='http://localhost:3100'; npx.cmd tsx scripts/smoke.ts` reports ALL PASSED, including screen permissions, synchronized playback, late-join state/timestamps, screen logs, owner controls while seated, room entry, reconnect and closure. This uses real demo HTTP/WebSocket connections without 3D rendering.
- PASS `node scripts/e2e-browser-picker.mjs --component` (also runnable as `node scripts/ui-host-panel.mjs`): four viewport/theme combinations, exact seven options, no symbol input, exact VNINDEX payload, exact text/image/audio/blank payloads, legacy TradingView/FPT labels and switch-away, YouTube/web panels, keyboard Home/End tabs, hidden scrollbar, no page errors and no panel overflow at 390/1440 plus 360 px. Temporary component route is removed in finally; no audit route is shipped. Initial 360 px overflow check FAILED, then passed after the file-input fix.
- Screenshots: `docs/screenshots/ui/after/host-panel-{390,1440}-{dark,light}.png`, `host-panel-chart-{390,1440}-{dark,light}.png`; machine-readable checks in `docs/screenshots/ui/after/host-panel-report.json`. These are the real OwnerPanel mounted without the 3D scene. Visually inspected desktop dark and mobile light captures. One actual room visit additionally saved `docs/screenshots/ui/after/host-panel-room-390-dark.png`, then closed immediately on a test error (about six seconds for the whole browser run).
- FAIL / limitation: the bounded real-browser picker run captured the actual panel but its subsequent chart-submit step failed because a script string was corrupted by shell encoding. Corrected the selector to `.ui-button-primary` and reran the component mode successfully; did not revisit the CPU-rendered room. An earlier attempt timed out on `/login` during dev reloads, before opening any room. The actual browser chart-persistence assertion is therefore not claimed as passing. Long multi-context YouTube/web/3D E2Es were not run; the existing room/screen smoke and component payload checks above passed. Claude visual review remains pending.
- Safety: only `D:/ActiveProject/AllOnline-ui`, local demo PGlite `.data-ui-audit`, market polling off, one server at a time on 3100. Server stopped and no listener remains on 3100. No access to `D:/ActiveProject/AllOnline`, live services, protocol/backend changes, deployment or push.

## AI Stock (see docs/AI-STOCK.md); tasks S-* run in the StockVN repo (worktree D:/ActiveProject/StockVN-dev)

### S-1 (StockVN): Equilibrium engine + evidence
Status: todo   Risk: medium
Goal: an `ml/equilibrium.py` that computes POC + value area (volume profile, minute bars when available), anchored VWAP (swing low/high) and Kijun-26 for each symbol. It detects confirmed breaks, weak breaks and retests as defined in AI-STOCK.md, and stores events in SQLite (new table, additive migration). Extend `pattern_eval` so every signal type (equilibrium events, existing S/R breakouts, candlestick patterns) gets hit rate, n, Wilson ci95 and the average return at 5/10/20 sessions, after fees, on VN100 history. Then compare the three equilibrium definitions.
Acceptance: unit tests on synthetic series (known POC/VWAP/Kijun). A report `docs/equilibrium-report.md` with a per-definition table (n, hit rate, ci, avg return per horizon) and a recommendation of the leading definition. Note survivorship bias. The existing tests pass.

### S-2 (StockVN): Classical chart patterns
Status: todo (after S-1)   Risk: medium
Goal: double top/bottom, head & shoulders (+inverse), ascending/descending/symmetrical triangles, flags. Detection is rule-based on the existing confirmed pivots, with neckline/breakout confirmation by volume. Output overlay geometry, and evaluate with the S-1 stats machinery.
Acceptance: tests on synthetic shapes, a stats report, and the existing tests pass.

### S-3 (StockVN): Scan snapshot + `/api/ai/scan`
Status: todo (after S-1)   Risk: medium (public API contract)
Goal: a scan job (after close, plus every 15 min in trading hours) that joins the ML rank, levels, equilibrium, signals and their stats into a versioned snapshot table. `GET /api/ai/scan?universe=VN100&limit=` returns exactly the contract in AI-STOCK.md from the cached snapshot (no synchronous fan-out). It is Bearer-token protected, and the API must refuse to run unauthenticated if `STOCKVN_PASSWORD`/token are unset in production.
Acceptance: an API test against the fixture DB, a contract test (JSON schema), and response time < 300 ms from the snapshot.

### A-1 (AllOnline): AI Stock stage mode
Status: review (implemented against typed fixture; Claude review pending)   Risk: high (realtime screen state, LLM, the core experience)
Goal: implement the "AllOnline" section of AI-STOCK.md: a server-side director + a new screen content kind `ai-stock` (backward compatible), the stage chart for any symbol with level/zone/pattern overlays, the signal card, Claude commentary (server only, cached, model from config with default `claude-opus-5-5`, a strict prompt: only use the given numbers, Vietnamese, no buy/sell advice, end with the disclaimer), the owner controls (bật AI, pause/skip/pin/stop, top N, seconds per stock), and the viewer list "Bảng AI Stock" (private view).
Design notes: add `STOCKVN_URL` and the token client for `/api/ai/scan`. Until S-3 ships, use a typed fixture provider that matches the contract exactly. With no Anthropic key, fall back to a template sentence. Rate-limit the LLM calls. Demo mode uses the fixture.
Acceptance: unit tests for the director (rotation/pause/pin, late-join state), the prompt builder (numbers come only from input) and the fallback. The `scripts/smoke.ts` room checks pass. Screenshots at 390/1440 with the 3D-safe procedure. lint, tsc, tests.

Result (Codex, 2026-11-09):
- Branch: `codex/ai-stock`, worktree `D:/ActiveProject/AllOnline-ui`. Local implementation commits: `5af060f` (typed contract/fixture, director, commentary and tests), `10f5eb1` (stage/host/viewer UI and integration checks); this Result and screenshots are committed separately. No push.
- Summary: added server-authoritative `ai-stock` screen content using the existing persisted screen/welcome channel, top-N rotation (default 8 / 45 seconds), pause/resume, skip, pin any snapshot symbol, stop and manual handoff. Host controls live in the existing owner panel; the room menu exposes **Bảng AI Stock**, whose selection stays local. Charts support S/R, POC/VWAP/Kijun, value-area/custom zones and line/pattern geometry. Signal cards show rank score/bias, up to three signals with empirical-rate/sample/horizon/CI, timestamp, source notice and disclaimer. The typed fixture is explicitly labelled synthetic, including its candles and statistics; it makes no external market or Claude calls.
- Claude: reused the receipt reader's `ANTHROPIC_API_KEY` handling through a shared server-only SDK client factory, checked the official TypeScript SDK docs/README (linked in AI-STOCK.md), and added `AI_STOCK_MODEL` defaulting to `claude-opus-5-5`. Commentary has a strict Vietnamese/input-only/no-advice/disclaimer prompt, bounded snapshot/symbol cache, in-flight deduplication, one new call per ten seconds, no retries, timeout, stale-response guard and deterministic fallback. SDK tests use mocks; no live Claude call or billing verification was performed. Receipt reading retains its existing model and behavior.
- Provider: `AI_STOCK_PROVIDER=fixture` remains the default pending S-3; demo mode always uses fixtures. Existing `STOCKVN_URL` / `STOCKVN_API_TOKEN` are reused for the opt-in Bearer client with schema validation and one-minute cache. Errors never masquerade as real fixture statistics. The private scan endpoint requires an attendee session, including guests; moderator permission checks cover all director commands. No DB schema/auth/payment protocol changes.
- PASS `npm.cmd run lint`: exit 0, 0 errors, 13 existing warnings. PASS `npx.cmd tsc --noEmit`: final exit 0. PASS `npm.cmd test -- --maxWorkers=2 --silent`: 17 files / 183 tests. PASS final focused `npx.cmd vitest run tests/ai-stock.test.ts --silent`: 9 tests (director deadlines/wrap/pause/pin/resume/skip/late-join serialization/manual handoff, fixture isolation/validation, Bearer/cache/errors, input-number prompt/fallback, configurable model, request cache/rate limit/refusal/failure). PASS `git diff --check`.
- PASS `$env:BASE='http://localhost:3100'; npx.cmd tsx scripts/smoke.ts`: ALL PASSED, including existing room/screen/permissions/playback/reconnect/closure checks and new real HTTP/WebSocket checks for unauthenticated scan rejection, moderator-only AI start, configured fixture/timing, server-driven rotation, pause/pin/resume/skip/stop, private list fetch and identical late-join snapshot/revision/control state. No browser 3D rendering is involved in this smoke script.
- PASS `node scripts/ui-ai-stock.mjs`: real components mounted without a Three scene, four viewport/theme combinations, visible chart overlays and sample labels, working pause/resume/skip/pin/select/stop/start controls, private HPG selection leaves the shared screen unchanged, no page errors or horizontal overflow at 390/1440 and 360 px. The temporary audit route is removed in finally; no audit route ships. Visually inspected desktop dark stage, mobile light stage and mobile light controls. PASS PNG dimension check: all 16 captures are exactly 390×844 or 1440×900.
- Screenshots: `docs/screenshots/ui/after/ai-stock-{stage,controls,list,private}-{390,1440}-{dark,light}.png`; machine-readable results: `docs/screenshots/ui/after/ai-stock-report.json`.
- FAIL then corrected: the first commentary test caught the advice filter matching the mandatory disclaimer itself; the guard now checks the body separately, and all tests pass. The first visual run failed because the demo launcher's blanked `PUBLIC_ORIGIN` was a whitespace string; restarting with `http://localhost:3100` fixed it. A `tsc` run overlapped temporary-route deletion and reported that missing audit file; the sequential final run passed. These failures are not outstanding application errors.
- Safety: only this worktree and its `.data-ui-audit` demo PGlite were used; market polling and external credentials were disabled. One server at a time on 3100, stopped at the end; verified no listener remains. No access/changes to the live project directory, no deployment or push. No actual 3D room scene was opened: component checks were used to avoid CPU-rendering risk, so an in-scene visual acceptance is not claimed.
- Open questions / review: Claude's high-risk review remains pending. S-3 must confirm non-empty overlay geometry fields, UTC seconds and thousand-VND units before the real provider is enabled (the architecture's example only specifies empty arrays). S-1 must supply an evidence-backed leading equilibrium definition; all three currently render equally and the UI explicitly labels the leader pending. Real StockVN snapshots and live Claude output remain unverified until those services are available; the output guard is heuristic, and semantic commentary quality needs review. The director holds its chosen snapshot until restarted; a future real-data rollout should decide the refresh cadence and how snapshot replacement interacts with a pinned stock.

### A-2 (AllOnline): AI Stock alerts UI + Zalo follow
Status: review (fixture implementation complete; proactive policy verification and Claude review pending)   Risk: high (Zalo messaging, realtime, additive DB migration)
Goal: implement the "Alerts" section of AI-STOCK.md on the AllOnline side: an alert banner on the stage while AI Stock is running (the current symbol, or a ticker of new alerts), ⚠ badges plus an alert history in "Bảng AI Stock", a "Theo dõi mã" button (follow list per account, stored in a new additive table via a migration in db/migrations), and Zalo Bot delivery to followers who have linked Zalo (the existing zalo_oa identity). Check the official Zalo Bot docs (bot.zaloplatforms.com/docs) for any proactive-messaging limits or time windows, and respect them (queue + skip if not allowed, logged). Dedupe once per symbol × level × beat per session, and add a per-user daily cap. Poll StockVN alerts every 60 s during trading hours (fixture in demo/default). Show percentages ONLY when `stats` is present.
Acceptance: unit tests (dedupe, cap, copy per kind without imperative words, no % without stats, Zalo window handling); smoke checks; screenshots at 390/1440 (component-level, 3D-safe); lint, tsc, tests.

Result (Codex, 2026-11-09):
- Branch/worktree: `codex/ai-stock`, `D:/ActiveProject/AllOnline-ui`. Reviewed all interrupted changes with `git diff` and consolidated one implementation. Local commits: `fc43214` (migration, follows, provider/queue, API and tests), `2d47d3c` (provider event-time eligibility/replay protection), `5cfdaf3` (banner, list badges/history/follow UI and visual harness); evidence/docs committed separately. No push.
- Summary: current-symbol/current-session stage banner; warning badges and two-beat alert history in the private list; account follow/unfollow persisted in additive migration `017_stock_alerts.sql`, capped at 100 symbols. Guests can read but cannot follow; follows are isolated per account. Typed fixture is default/demo, clearly labelled synthetic. Real provider is opt-in Bearer-authenticated `/api/ai/alerts?since=`, polled every 60 seconds within the existing VN weekday session envelope. Feed errors retain history with a stale-data notice; browser polls every 15 seconds. Conditional/base percentages only render when `stats` exists, with sample/horizon/CI/outcome; copy covers every kind without imperative trade instructions and carries the risk disclaimer.
- Delivery: durable dedupe per provider × VN session date × symbol × level × beat, independent of upstream ID/kind, survives restart. Queue checks linked `zalo_oa` private-chat contact, current follow, session freshness and verified window; account row locks reserve a five-attempt daily cap. Reason-coded skips are logged and stored. Failed/ambiguous/interrupted attempts consume the cap and are never automatically resent. Provider queues are isolated; fixture transport is captured. Webhook contacts use provider `message.date` in milliseconds; missing/future/older timestamps cannot reopen eligibility.
- Official Zalo docs: checked [sendMessage](https://bot.zaloplatforms.com/docs/apis/sendMessage/), [webhook](https://bot.zaloplatforms.com/docs/webhook/), [errors](https://bot.zaloplatforms.com/docs/error-code/), [terms](https://bot.zaloplatforms.com/docs/terms/) and [index](https://bot.zaloplatforms.com/docs/). Direct HTTPS succeeded after browser-tool failures. `sendMessage` documents `chat_id`, text length 1–2,000; errors include 429 quota exceeded; webhook date is Unix milliseconds. These pages do **not** document a numeric proactive-messaging time window or establish follow-click permission. No OA 24/48-hour rule is assumed. Default policy is fail-closed: unset `ZALO_ALERT_VERIFIED_WINDOW_SECONDS` queues then logs/skips `policy_unknown`; the UI explains delivery is paused. An operator must verify actual Bot plan/permission/window before setting it; additional platform criteria would need gate changes. No live delivery entitlement is claimed. Details in `docs/AI-STOCK.md`.
- PASS `npm.cmd run lint`: final 0 errors, 13 existing warnings. PASS `npx.cmd tsc --noEmit`, run after temporary audit-route cleanup. PASS `npm.cmd test -- --maxWorkers=2 --silent`: 18 files / 205 tests. PASS focused alert + webhook suite: 2 files / 40 tests, including dedupe/restart/session rollover, concurrent cap reservations, all six copy kinds, stats gating, follow isolation/unfollow/account deletion, unknown/expired/future windows, replayed webhook timestamp, stale session, missing chat, failure/no retry, fixture/real queue isolation, guest exclusion, future alerts, 60-second polling, stale history, Bearer/validation and non-session polling suppression. PASS `git diff --check`.
- PASS `$env:BASE='http://localhost:3100'; npx.cmd tsx scripts/smoke.ts`: ALL PASSED, twice, including existing room/screen/director/WebSocket checks and new HTTP alert auth, typed fixture, idempotent follows, per-account isolation, invalid-symbol rejection, persisted unfollow, guest read/denied follow and disabled unknown messaging policy. No browser/Three scene is involved in this smoke script. The final timestamp-only Bot change is covered by the subsequent focused/full tests.
- PASS `node scripts/ui-stock-alerts.mjs`: real components mounted without any Three scene, four width/theme combinations, current-symbol banner without percentages, two-beat history with conditional stats, warning badges, actual demo follow/unfollow and persistence after page reload, no page errors or horizontal overflow at 390/1440 and 360 px. Only feed data is intercepted with a deterministic two-beat fixture, explicitly including a synthetic close alert before today's close; follow APIs are real demo requests. Temporary route removed in `finally`; browser contexts closed. PASS PNG dimensions: 16 captures exactly 390×844 or 1440×900. Visually inspected mobile light banner/history and desktop dark history/follow.
- Screenshots: `docs/screenshots/ui/after/stock-alerts-{stage,list,history,follow}-{390,1440}-{dark,light}.png`; evidence: `docs/screenshots/ui/after/stock-alerts-report.json`.
- FAIL then corrected: an intermediate lint run included the temporary CommonJS demo launcher and rejected its `require`; removed launcher and reran lint successfully. Browser-tool Zalo-doc retrieval failed, so official pages were fetched directly. First history captures placed most history below the viewport; added separate list captures and scrolled to history, then regenerated all captures. No outstanding failed acceptance check.
- Safety: only this worktree and worktree-local `.data-a2` PGlite demo data. Credentials blanked, market scheduler off, fixture providers and captured/mocked outbound calls. One demo server at a time, port 3100 only; stopped after verification and confirmed no listener. No live project directory access/changes, live DB, live Zalo/Claude/StockVN call, deployment or push. No actual 3D scene mounted; in-scene visual behavior and a production build are not claimed.
- Open questions/review: Claude high-risk review of migration/queue/webhook is pending. Confirm actual Bot proactive permission/window and plan quotas before enabling delivery; the configurable window is not an entitlement API. Confirm real StockVN contract/approved-method gate, holiday/lunch scheduling and handling close alerts arriving after the poll envelope. Agree retention for history/contact/delivery records and a manual reconciliation policy for interrupted `sending` attempts. The empirical stats are fixtures, not verified live evidence.

### T-9: AI plan per account (off / basic / VIP)
Status: review   Risk: high (DB migration, per-user entitlement, admin action)
Goal (owner, 2026-11-09): the admin turns AI on per account. A **VIP** gets AI across the whole market (VN100 scan, AI Stock screen in rooms, the full alert feed) plus every alert kind for their watchlist. A **basic** (normal) account receives only resistance alerts (`near_resistance`, `break_resistance`) for its own watchlist. **Off**: no AI at all.
Scope: migration `018_ai_plan.sql`, a new `server/services/ai-plan.ts` (or similar), the alerts ingest/deliver/feed paths, `/api/ai-stock/*` routes, the hub `screen ai_stock start` check, a new admin tab "Tài khoản", and a watchlist section on the account page. Out of scope: payments for VIP, StockVN, Zalo policy, enabling the live provider.
Design notes:
- Schema (additive): `app.users.ai_plan text not null default 'basic' check (ai_plan in ('off','basic','vip'))` plus `ai_plan_until timestamptz null` (null = no expiry; after expiry VIP behaves as basic). Existing users become basic.
- One function decides everything: `effectivePlan(user, now)`. `app_owner` → vip; `is_guest` or `is_demo` account → off (demo rooms keep their fixture behaviour); otherwise ai_plan, with expired vip → basic. Do not scatter plan checks: routes, hub and alerts call this function.
- Kinds per plan: vip = all kinds; basic = `near_resistance`, `break_resistance`; off = none. Keep that list in `src/core` so the UI and server share it.
- Alerts: at ingest, queue deliveries only for followers whose effective plan allows the alert kind. At deliver, re-check the plan (it can change between queue and send), and skip with reason `plan`. The feed (`GET /api/ai-stock/alerts`): vip = the whole feed; basic = only its watchlist symbols and only resistance kinds; off = 403.
- Watchlist (`stock_follows`): basic up to 10 symbols, vip up to 50, off = 403. Validate symbols against the market symbol list the server already has (no free text into the DB beyond the existing regex).
- `GET /api/ai-stock/scan` and starting the AI Stock room screen require vip (the room owner's plan). Viewers in a room can watch what a VIP host presents. Demo rooms are unchanged.
- `GET /api/me` (or the existing session endpoint) returns `aiPlan` and the allowed kinds, so the UI can hide what the user cannot use and show the reason in Vietnamese: "Tính năng VIP. Liên hệ quản trị để nâng cấp."
- Admin tab "Tài khoản": search by name, email or Zalo name, paginated; each row shows the plan with a select (Tắt / Thường / VIP) and an optional "đến ngày". The change is written to the existing admin/room log with the actor. Only app_owner can use it (reuse the existing admin guard). The admin cannot change their own role from here.
- Account page "Mã theo dõi": add/remove symbols, show the limit, the plan and what alerts the plan sends ("Tài khoản thường: chỉ nhận cảnh báo kháng cự").
- Zalo delivery stays behind `ZALO_ALERT_VERIFIED_WINDOW_SECONDS` exactly as now. Do not loosen it.
Acceptance:
- Unit tests: effectivePlan (owner, guest, demo, expiry); ingest queues a basic follower for `near_resistance` and not for `near_support`, a vip for both, off for none; deliver skips with `plan` after a downgrade; feed filtering per plan; follow limits 10/50 and 403 for off; scan and AI screen start refused for basic; admin endpoint refuses a non-owner.
- Migration applies on a fresh demo PGlite and on top of 017.
- UI check in demo mode at 390 and 1440, dark and light: the admin "Tài khoản" tab and the account "Mã theo dõi" section. Screenshots go in `docs/screenshots/ui/after/ai-plan-*.png`.
- `npm run lint`, `npx tsc --noEmit`, `npm test`, **and `npm run build`** (a build failure took the live site down on 2026-11-09).
Result (Codex):
- Branch/worktree: `codex/t-9-ai-plan`, `D:/ActiveProject/AllOnline-ui`. Implemented locally; no push. High-risk architecture review remains pending.
- Summary: additive `018_ai_plan.sql`; shared `effectivePlan`, alert kinds and follow limits; fresh DB entitlement checks for scan, follows and AI screen startup using the room owner's plan. Alert ingest filters followers by plan, delivery rechecks under the existing account lock and records `plan` skips, and feed filtering happens in SQL before the 100-alert limit. Existing Zalo window/cap/dedupe gates are unchanged. Session metadata exposes the effective plan, allowed kinds and follow limit; plan edits invalidate the target's auth cache.
- UI: owner-only, searchable, paginated **Tai khoan** admin tab with plan/date editing and actor/before/after system log; strict input rejects role changes. Account **Ma theo doi** section shows plan, limit, kinds, market-symbol search, persistent follows and filtered history. Vietnamese UI copy includes the required basic/VIP explanations. Room controls receive the host entitlement rather than using a co-host's personal plan. Shared sample presentations stay visible to demo-room guests without granting private scan access.
- Decisions: VIP expires at `now >= ai_plan_until`; owner override takes precedence over guest/demo flags. The admin date picker means end of the selected calendar day in Vietnam (16:59:59.999 UTC); null has no expiry. Downgrades preserve existing follows, block new additions until below the effective limit, and apply the new kind filter immediately; off accounts cannot access or mutate follows. Starting/restarting AI rechecks the owner; an already presented screen remains watchable and stoppable. Market validation uses only the existing local symbol table; the demo harness seeds one clearly local FPT sample without refreshing a remote source.
- PASS `npm.cmd run lint`: exit 0, 0 errors, 13 existing warnings. PASS `npx.cmd tsc --noEmit`: exit 0. PASS `npm.cmd test -- --maxWorkers=2 --silent`: 20 files / 218 tests. PASS `npm.cmd run build`: exit 0, Next.js 16.4.5 compiled successfully, TypeScript completed, 12/12 static pages generated and route optimization completed. Build was repeated after the final room-control correction; typecheck ran sequentially after build. PASS `git diff --check`.
- Tests: seven new plan tests cover owner/guest/demo/expiry, basic/VIP/off ingest and feeds, downgrade-before-delivery, concurrent 10/50 follow limits and idempotence, unknown symbols, HTTP 403s, non-owner admin rejection, role-input rejection, audit actor, Zalo-name search, session metadata, fresh migration and applying 018 over 017 with existing users/follows. Hub tests use captured sockets to verify startup rejection, upgrade/downgrade rechecks, an off-plan viewer watching the VIP host, and unchanged demo-room fixture startup. Existing outbound integration tests remain mocked.
- PASS `node scripts/ui-ai-plan.mjs`: `PASS AI plan UI: 16 captures, 390/1440 dark/light, admin editing, follows, no page errors or overflow`. Uses real demo HTTP APIs for search, admin update/restore, add/remove and persistence after reload; seeded basic/VIP/off local accounts. Screenshots: `docs/screenshots/ui/after/ai-plan-{admin,account-basic,account-vip,account-off}-{390,1440}-{dark,light}.png`; report: `ai-plan-report.json`. Visually inspected mobile dark admin, desktop light admin and mobile light basic account. No Three scene mounted.
- Corrected during verification: Windows shell encoding damaged new Vietnamese copy; rewrote it as UTF-8 and checked the screenshots. Browser search caught the shared Button's default non-submit behavior; added explicit submit. Captured-socket testing needed `OPEN=1`; the Zalo-name test needed separate text/UUID SQL parameters. These intermediate failures were corrected before the final passing checks.
- Safety/reproduction: `node --import tsx scripts/demo-t9.mjs` refuses a different worktree, blanks every Config credential before env loading, uses `.data-t9/pglite`, fixture provider and `MARKET_DATA=off`, and binds port 3100 only. One dev server at a time, stopped before production build; final port check shows no listener. No live project directory, live DB, Zalo, StockVN or Claude API access, deployment or push. Review the migration/entitlement/admin changes before rollout; live-provider interoperability was deliberately not exercised.

## Reports (owner request 2026-11-10); run in the StockVN repo, worktree D:/ActiveProject/StockVN-dev, branch `codex/reports`

### R-1 (StockVN): Report engine + `/reports` page (reports 01–05)
Status: done (codex/reports bdb817d; result StockVN-dev docs/R-1-RESULT.md)   Risk: medium (new table + new page; no auth change)
Goal: an owner-facing **Báo cáo** page in StockVN with five daily reports, built so that a new report later = one Python function + one registry entry (the page renders any report generically). The owner explicitly asked for this page, which overrides the old "no more UI" note in StockVN's CLAUDE.md.
Universe: `universe_members` group `LIQUID` (filled by Claude's overnight ingest: every HOSE/HNX/UPCOM symbol whose last-20-session average traded value close×volume ≥ 1 tỷ VND, traded ≥ 18/20 sessions, last bar ≤ 10 days old) ∪ VN100. Daily bars only. Claude's prototype is `C:/Users/admin/AppData/Local/Temp/claude/5f230f645edcf8a6/dec56bfd-bbde-4d18-a675-5d1b53ec8985/scratchpad/ingest_liquid.py`: port it into the repo as `ml/liquid.py` (same rule, resumable, `--db`, throttled HttpClient), with tests on a fake fetcher. Also make the existing daily job refresh LIQUID symbols incrementally (recent sessions only, not a full re-download). Do NOT run network downloads yourself: the ingest is running in this worktree's DB right now (`data/stockpilot.sqlite`, writes may be in progress). Use temp DB copies for tests.
Shared per-symbol features (as of the last session): close, %change, ATR14 (`ml.indicators.atr`), avg traded value 20, volume ratio = volume / prior-20 average, last-session candle (`ml.candles.detect`), nearest resistance above / support below exactly as `ml.ai_scan.next_zones` (the same levels as the live alerts), equilibrium from `ml.equilibrium.levels` / `detect` (POC + value area, anchored VWAP, Kijun-26).
Report rules (fixed before seeing results; do not tune them on the output):
- **01 Tiến đến kháng cự:** resistance R exists, 0 ≤ (R − close)/ATR ≤ 1.0, and close > close 5 sessions ago. Sort by distance in ATR, ascending.
- **02 Quay về hỗ trợ:** support S exists, 0 ≤ (close − S)/ATR ≤ 1.0, and close < close 5 sessions ago. Sort ascending.
- **03 Mất cân bằng:** group (a) "Vừa phá cân bằng": a *confirmed* break (volume ≥ 1.5×) of POC, VWAP or Kijun in the last 5 sessions and close still on the broken side; show which level(s) and the direction. Group (b) "Lệch xa cân bằng": close outside the value area and |close − POC| ≥ 2 ATR. Sort by distance, descending.
- **04 Vừa vào cân bằng (đáng chú ý):** group (a) "Vừa lấy lại cân bằng": an up-cross (confirmed or weak) or `retest_up` of POC/VWAP/Kijun in the last 3 sessions, close now inside the value area or above POC, and within the prior 20 sessions some close was below value_low or ≥ 1 ATR below POC. Group (b) "Tích lũy quanh cân bằng": max−min of (POC, VWAP, Kijun) ≤ 1 ATR and |close − their mean| ≤ 0.5 ATR. Copy says "đáng chú ý, bạn tự quyết", never "nên mua".
- **05 Đúng indicator nhất (VN100):** from `approved_methods`, horizon 10. Table A: per symbol, its best method with OOS n ≥ 30, ranked by the Wilson 95% lower bound; columns OOS hit, wins/n, Wilson LB, IS hit (n), base rate, lift, OOS net, BH significance, status, and a "nhất quán" flag (IS hit ≥ base AND OOS hit ≥ base). Table B: per symbol, all methods pooled (OOS wins/n vs n-weighted base), the top 15 and bottom 10 by lift. Header: "x PASS / y EVIDENCE trên N phép thử", the gate rules and a plain note that 0 PASS means no method is reliable yet.
- Rows in 01–04 show historical % ONLY through `ml.validation.displayable()` (PASS/EVIDENCE) for the matching method × symbol (res_touch, sup_touch, eq_*). Otherwise show "chưa đạt chuẩn" (VN100) or "chưa kiểm định" (others). Never compute or show ungated percentages.
Storage: additive table `report_snapshot(report_key, as_of, generated_at, payload_json, PRIMARY KEY(report_key, as_of))`. Payload is generic: `{title, description, asOf, universeSize, groups:[{title, note, columns:[{key,label,type: text|price|pct|atr|int|vnd|badge}], rows:[…]}]}`. `ml/reports.py` holds the registry and a CLI `python -m ml.reports [--db] [--only 01]`. Run it at the end of the daily pipeline after the scan.
Web: `GET /api/ai/reports` (list of reports + latest asOf) and `GET /api/ai/reports/[key]` (latest snapshot), under the existing `/api/ai` gate. The page `/reports` has tabs 01–05 (`?r=01`) and one generic table renderer: sortable columns, the symbol links to the existing chart/backtest page, horizontal scroll inside the table on phones, freshness time, universe size and the disclaimer "Thông tin phân tích kỹ thuật để tham khảo, không phải khuyến nghị mua bán." Add a nav link. Vietnamese UI, existing StockVN styling, works at 390 px.
Docs: add every rule above with its source to `docs/METHODS.md` (Edwards & Magee; Murphy 1999; Wilder 1978 for ATR; Dalton/CBOT for value area; Hosoda for Kijun; Wilson 1927; Benjamini–Hochberg 1995). Operational thresholds (1 ATR, 5 sessions, 2 ATR…) are labelled as fixed local choices.
Acceptance: pytest on synthetic series for each of the rules 01–04 (positive and negative cases) and for 05 ranking/flags; API tests; `npm.cmd run lint`, `npm.cmd run test`, `npm.cmd run build`, `.venv\Scripts\python.exe -m pytest ml\tests -q` all pass. Run `python -m ml.reports` on this worktree's real DB and paste the row counts per report. Start ONE dev server on port 3300 (never 3200, which is live), capture `/reports` for every tab at 1440 and 390 into `docs/screenshots/reports/`, check there are no page errors, stop the server and confirm the port is free. Commit locally on `codex/reports`; do not push, do not touch `D:/ActiveProject/StockVN`.
Result (Codex):

### R-2 (StockVN): zone alerts for the watchlist + fast chart loading
Status: done (0f36299; result StockVN-dev docs/R-2-RESULT.md)   Risk: medium (alert scope + caching)
Goal 1 (owner 2026-11-10): the two-beat zone alerts (`ml/ai_alerts.py`: near/break resistance, support, POC/VWAP/Kijun) must also cover the owner's **watchlist** (`db.watchlist_symbols`, currently VDS, IDC, VSC, HDC, VGS), not only VN100. Today `ml.ai_common.universe()` returns VN100 only, so VDS touching resistance raises nothing.
- Add one function for the alert/scan universe = VN100 ∪ watchlist (minus VNINDEX), with an optional setting (env `STOCKVN_ALERT_UNIVERSE`, values `VN100+WATCHLIST` default, `VN100+WATCHLIST+LIQUID`) for later. Use it in `ai_scan.run` (so the pre-session snapshot has levels for every alerted symbol) and in `ai_alerts.intraday` / `close`.
- `ml.live` must keep 1-minute bars fresh for every symbol in that universe during the session (it already refreshes the watchlist; check VN100 and avoid duplicate fetches), staying within the current throttle.
- Alerts are delivered through the existing StockVN Zalo path to the owner exactly as for VN100 today (beat 1 "vào vùng ... chờ nến kết phiên", beat 2 the closing candle). Keep once per symbol × level × beat per session. Percentages only through `ml.validation.displayable()`.
- Tests: a watchlist symbol outside VN100 entering a resistance zone produces a beat-1 alert and a beat-2 alert at the close; a symbol outside both sets produces none; no duplicates.
Goal 2: `/chart/[symbol]` is slow (VDS daily ≈ 6 s) because `/api/ai/replay` runs the whole Python analysis on every request. Add a cache keyed by (symbol, interval, from, to, last stored bar time): reuse while the data has not changed. Intraday intervals during the session: at most 60 s old; daily outside the session: until a new daily bar is stored. After the daily pipeline, pre-warm the watchlist symbols for 1d and 15m. Bound the cache size (no unbounded memory or disk growth). Second load of `/chart/VDS` should answer in < 300 ms.
Acceptance: pytest + vitest for both goals, `npm.cmd run lint`, `npm.cmd run test`, `npm.cmd run build`, `.venv\Scripts\python.exe -m pytest ml\tests -q`. Measure the first and second `/api/ai/replay?symbol=VDS&interval=1d` times on a dev server on port 3300 (never 3200) against this worktree's DB, and paste them. Commit locally; no push; do not touch D:/ActiveProject/StockVN. Result into `docs/R-2-RESULT.md` in the worktree.
Result (Codex):

### R-1b (StockVN): readability polish for `/reports` (Claude review of R-1, 2026-11-10)
Status: done (a92b17a)   Risk: low
Fix, without changing any report rule:
- Default row order = the server's order (each report's own ranking, e.g. 01/02 nearest first, 03 farthest first). Today the table starts sorted by symbol A→Z. Clicking a header still sorts; a "Mặc định" option restores the server order.
- Per-report column sets, key columns first, the rest behind a "Thêm cột" toggle. 01: Mã, Sàn, Giá, Thay đổi, Kháng cự, Khoảng cách (% and ATR), KL/TB20, Nến, Lịch sử kiểm định. 02: the same with Hỗ trợ. 03/04: Mã, Sàn, Giá, Thay đổi, Mức/hướng, POC, Vùng giá trị (low–high), VWAP, Kijun, Khoảng cách ATR, KL/TB20, Lịch sử. 05: Mã, Phương pháp, OOS hit, Thắng/n, Nền, Lift, Nhất quán, Trạng thái; the rest behind the toggle. Add the exchange (HOSE/HNX/UPCOM from `listed_symbols`) to every row and a filter by exchange.
- Vietnamese labels instead of codes: methods (eq_vwap_weak_down → "VWAP ↓ (yếu)", res_touch → "Chạm kháng cự", candle_* → the Vietnamese candle name from `ml.candles.PATTERNS`, pat_* → the pattern name), statuses (chua_dat_chuan → "Chưa đạt chuẩn", PASS → "Đạt chuẩn 80%", EVIDENCE → "Có bằng chứng").
- Times in Vietnam time, e.g. "02:47 10/11/2026"; session dates as dd/mm/yyyy.
- Re-run `python -m ml.reports` on the worktree DB, retake the 10 screenshots (1440 and 390) against a fresh backup of the real DB (universe 279, not 100), lint/test/build/pytest, commit locally on `codex/reports`. Result in `docs/R-1-RESULT.md` (append a "R-1b" section).
Result (Codex):

### R-2b (StockVN): fix two regressions found in Claude's review of R-2 (0f36299)
Status: done (b293d5f)   Risk: high (owner's Zalo delivery)
1. **Zalo flood.** `ai_alerts.send_pending` now sends every VN100 + watchlist zone alert to the owner's Zalo, one message each. Before R-2 these VN100 alerts were only stored (for the AllOnline feed), never sent. With up to five levels per symbol this can mean hundreds of messages a session and Zalo 429s. Fix: the owner's Zalo receives alerts ONLY for watchlist symbols (`db.watchlist_symbols`); VN100-only alerts stay stored and are marked as not-for-Zalo (no delivery row, no send). Batch all pending watchlist alerts of one run into ONE message (split only above the 2,000-character Bot limit), and cap owner AI alert messages at 20 per VN calendar day (log and skip the rest). Keep receipts and the "acknowledge only after a successful send" rule. Tests: VN100-only alerts never reach the sender; 7 watchlist alerts → 1 message; the cap holds; retries after a failed send don't duplicate.
2. **Charts lost the network fallback.** R-2 made `/api/ai/replay` read stored candles only. Before R-2, a symbol without stored bars was fetched from VCI, and watchlist minute charts topped up the latest ~1 session from VCI. Now any symbol outside the stored set fails, and minute charts are stale unless `ml.live` runs. Restore the original data loading exactly (stored first, VCI fallback/top-up as before) on a cache miss; keep the cache in front of it. Cache identity: if the result used any network data, the entry lives at most 60 s during the session (Mon–Fri 09:00–15:00 VN) and at most 10 min otherwise; results built only from stored data keep the stored-bar stamp rule from R-2. Tests with fake fetchers: unknown symbol → fetched and charted; watchlist 15m → includes the fetched latest bars; cached hit does not call the fetcher; expiry rules.
Acceptance: pytest, `npm.cmd run test`, `npm.cmd run lint`, `npm.cmd run build`. On a 3300 dev server: time `/api/ai/replay?symbol=VDS&interval=1d` first and second load again, and confirm `/api/ai/replay?symbol=HPG&interval=15m` and a symbol outside the DB (pick one from `listed_symbols` that is not in `daily_candles`) both return 200 (this is the only network use allowed: one or two chart fetches). Commit locally on `codex/alerts-watchlist`; append an "R-2b" section to `docs/R-2-RESULT.md`.
Result (Codex):

### R-3 (StockVN): zone alerts for every liquid stock, 5-minute checks, close status + reversal statistics
Status: done (Codex ce44e7f + Claude zone_stats 316a20f, review fixes 7ddd16d)   Risk: high (owner's Zalo delivery, new statistic shown to the owner)   Branch: `codex/zone-reversal` from `claude/nightly-2026-11-10`
Owner request (2026-11-10, verbatim): "Trong phiên liên tục định kỳ 5 phút 1 lần kiểm tra nến ngày. Bất cứ cổ nào rơi vào vùng cảnh báo thì lập tức nhắn tin cho cổ đó (chỉ nhắn tin 1 lần). Kết phiên hãy nhắn lại trạng thái cổ phiếu đó. Phân tích tỉ lệ % đảo chiều tại vùng đó (dựa vào nến đóng cửa, cụm nến ... ví dụ sẽ hình thành bộ nến sao mai ...)". This replaces R-2b's "watchlist only" Zalo rule.
1. **Universe.** Default `STOCKVN_ALERT_UNIVERSE` becomes `VN100+WATCHLIST+LIQUID` (≈280 symbols). `ai_scan` must therefore write pre-session levels for all of them; check the scan time stays reasonable and report it.
2. **5-minute checks.** `ml.live`: watchlist keeps 1-minute refresh (charts); every other symbol in the universe is refreshed every 5 minutes (aligned 09:05, 09:10, …), within the current throttle. The zone check runs every 5 minutes on the forming daily candle: a symbol is "in the zone" when a minute bar since the open has its low ≤ level + zoneWidth and high ≥ level − zoneWidth (fall back to close if high/low missing) for any level in the pre-session snapshot (resistance, support, POC, VWAP, Kijun; value area excluded as today).
3. **One message per stock per session.** The first time a symbol enters any zone in a session it goes into that run's batch; later touches of the same symbol that day are stored but never sent again. One Zalo message per 5-minute run listing all new symbols (one line each: mã, vùng (loại + mức), giá hiện tại, "chờ nến kết phiên"), split only above the 2,000-character limit. Replace the 20/day cap with 80/day (log and skip the rest). Keep "acknowledge only after a successful send", no duplicates after a failed send, serialized senders.
4. **Close status.** After the daily pipeline stores today's daily bar, send ONE batched message (split at the limit) with one block per symbol touched today: zone touched, close vs the zone (giữ vùng / đóng vượt lên / đóng thủng xuống, using close vs level ± zoneWidth), the completed candle pattern(s) ending today (`ml.candles.detect`, Vietnamese names), any **pattern in progress** (today could be candle 1 or 2 of a 2–3-candle pattern, e.g. a long red candle at support = possible first leg of Sao mai), and the reversal statistics below. For a symbol with a pattern in progress, send a short follow-up at the next 1–2 closes ("Sao mai đã hình thành" / "không hình thành"), then stop.
5. **Reversal statistics (new module `ml/zone_stats.py`).** Built nightly from history, stored in an additive table, read at message time; never computed from today's data.
   - Event: a daily session that touches a level (same touch rule as item 2, daily high/low) where the levels are computed **point in time** from data up to the previous session only, with the same functions as the live scan (`ml.ai_scan.next_zones` / `ml.equilibrium`). Test explicitly that no future bar leaks into the levels. If computing levels for every session is too slow, compute them every 5 sessions and say so in the result.
   - Outcome "đảo chiều" (fixed before looking at results, do not tune): from the confirmation close (touch day, or the day the pattern completes), price reaches +1 ATR14 in the reversal direction (up at support, down at resistance) before it reaches −1 ATR14 the other way, judged on closes, within 10 sessions; neither = not a reversal.
   - Conditions: zone type × touch-day closing candle group (bullish reversal pattern / bearish reversal pattern / neutral / closed beyond the zone) and, separately, completed 2–3-candle patterns (morning/evening star, engulfing, harami …) at that zone. Base rate = all touches of that zone type.
   - Pooled over LIQUID (per-symbol samples are too small); also per symbol when n ≥ 30.
   - Display rule (owner asked for it explicitly; this is the EVIDENCE style): show a % only when n ≥ 30, always together with n, the Wilson 95% interval and the base rate, e.g. "Lịch sử chạm hỗ trợ + Sao mai: đảo chiều 61% (n=148, 53–68%) — mọi lần chạm hỗ trợ: 49%". n < 30 → "chưa đủ dữ liệu". Never "nên mua/bán". Each message ends with "Thông tin tham khảo, không phải khuyến nghị mua bán."
   - Add the rule, the outcome definition and sources to `docs/METHODS.md` (Nison 1991 for candle patterns; Edwards & Magee / Murphy 1999 for support/resistance; Wilder 1978 ATR; Wilson 1927). The thresholds (±1 ATR, 10 sessions, n ≥ 30) are fixed local choices; label them so.
   - Run it on this worktree's real DB and paste the table of rates (zone × candle group, top patterns) in the result.
**Split (owner 2026-11-10: Codex ~70%, Claude ~30%).** Codex does items 1–4 plus the message wiring. Claude writes item 5 (`ml/zone_stats.py`, its tests, the METHODS.md section, the nightly build hook) on branch `claude/zone-stats` in a separate worktree, merged afterwards. Codex must NOT create `ml/zone_stats.py`; code against this interface and use a fake in tests:
`zone_stats.lookup(conn, *, side: "support"|"resistance", level_type: str, candle: str | None, pattern: str | None, symbol: str | None = None) -> dict | None` → `{"rate": 0.61, "n": 148, "lo": 0.53, "hi": 0.68, "baseRate": 0.49, "baseN": 9800, "scope": "pooled"|"symbol", "label": "chạm hỗ trợ + Sao mai"}`, or `None` when the table is missing (render nothing) — n < 30 returns a dict with `rate=None` (render "chưa đủ dữ liệu"). `zone_stats.candle_group(candle_key) -> "bull_reversal"|"bear_reversal"|"neutral"` and `zone_stats.pending_patterns(df) -> list[{"pattern": key, "name_vi": str, "needs": 1|2}]` (patterns today could be leg 1 or 2 of) also come from Claude; import lazily (`try: from ml import zone_stats except ImportError: zone_stats = None`) so your branch runs before the merge.
Tests: synthetic sessions — a LIQUID symbol outside VN100/watchlist entering a zone produces exactly one message line all day even when it touches 3 levels; a batch of 12 new symbols = 1 message; close status lists each touched symbol with the right zone verdict; the pattern-in-progress follow-up fires on day 2/3 and then stops; point-in-time levels; outcome labelling (up first / down first / neither); n < 30 shows "chưa đủ dữ liệu"; failed send retries without duplicates; cap.
Acceptance: `.venv\Scripts\python.exe -m pytest ml\tests -q`, `npm.cmd run lint`, `npm.cmd run test`, `npm.cmd run build` pass. A dry-run replay of session 2026-11-07 (or the last full session with stored minute bars) on a temp DB copy, printing the 5-minute messages and the close message exactly as Zalo would receive them; paste them. No real Zalo sends, no network downloads, never port 3200, do not touch D:/ActiveProject/StockVN. Commit locally on `codex/zone-reversal`; result in `docs/R-3-RESULT.md`.
Result (Codex):

### R-3b (StockVN): one alert per touch episode + "Đang ở vùng cảnh báo" list on the page and by Zalo command
Status: done (Codex 8d74e79, review fixes 3a51b0d: Zalo has no update_id)   Risk: high (owner's Zalo; inbound commands)   Branch: `codex/zone-reversal` (after R-3, merged with Claude's `claude/zone-stats`)
Owner (2026-11-10): "1 lần chạm trong đợt thì chỉ báo 1 lần, người dùng có thể vào danh sách báo cáo để xem những mã nào đang ở vùng cảnh báo. Hoặc zalo có thể nhắn lệnh để gửi về danh sách này."
1. **Episodes.** A touch belongs to an ongoing episode when the same symbol × level type was touched in any of the previous 5 sessions (`zone_stats.EPISODE_GAP`; same rule as the statistics, `zone_stats.first_touches`). The 5-minute message only lists a symbol when at least one level it touches today opens a NEW episode; days spent inside the zone stay silent. The close status still covers every symbol that got a beat-1 message today. Touches are still stored (the list below needs them).
2. **Report 06 "Đang ở vùng cảnh báo".** New registry entry in `ml/reports.py`, generic payload as 01–05. Rows = symbols whose latest price (today's last minute bar during the session, else the last daily close) is within zoneWidth of a level in the newest pre-session snapshot. Columns: Mã, Sàn, Giá, Vùng (loại + mức), Khoảng cách (ATR), Ngày bắt đầu đợt, Số phiên trong vùng, Nến hôm qua, Tỉ lệ đảo chiều (`zone_stats.render(zone_stats.lookup(...))`). Sort: newest episode first, then distance. During the session the live loop refreshes this snapshot every 5 minutes (one row in `report_snapshot` per session, overwritten); the page tab shows the snapshot time. No other report changes.
3. **Zalo command.** The owner sends the bot `vung` (also accept `vùng`, `/vung`, `ds`): the bot replies with the report-06 list (one line per symbol: mã, vùng+mức, giá, số phiên trong vùng), split at the 2,000-char limit, plus the page link `https://stockvn.sankhau.pro.vn/reports?r=06`. `help`/`?` replies with the command list. Answer ONLY the owner's configured chat id (the one `zalo.send_message` uses by default); ignore and log everything else. Poll inbound messages with the existing `zalo.recent_chats`/`getUpdates` code: inside `ml.live` during the session (each loop, non-blocking: short timeout), and a small standalone loop `python -m ml.zalo_commands` for outside session hours, started by the existing Windows run scripts next to live. Remember the last processed update id in the DB so a restart never answers twice. Replies do not count against the 80/day alert cap (separate counter, cap 50/day).
Tests: same symbol touching on 3 consecutive days → 1 message; touching again after 6 quiet sessions → new message; report 06 rows for a synthetic snapshot; command parsing (vung/vùng//vung/ds/help/unknown); non-owner chat ignored; restart does not re-answer (update id persisted); reply split at the limit.
Acceptance: pytest, `npm.cmd run lint`, `npm.cmd run test`, `npm.cmd run build`; screenshot `/reports?r=06` at 1440 and 390 on a 3300 dev server (never 3200) with a dry-run snapshot; print the exact reply text for `vung` on the real DB copy. No real Zalo sends, no network downloads. Commit locally; append "R-3b" to `docs/R-3-RESULT.md`.
Result (Codex):

## Glossary (owner request 2026-11-11); StockVN repo, worktree D:/ActiveProject/StockVN-glossary, branch `codex/glossary`

### G-1 (StockVN): Từ điển thuật ngữ `/thuat-ngu` + popup giải nghĩa khi rê chuột

**Owner:** "lập 1 trang định nghĩa, chú thích các khái niệm dùng trong các báo cáo, hoặc sau này trong các trang có từ ngữ kỹ thuật chứng khoán. Ở đâu xuất hiện khái niệm đã định nghĩa thì rê chuột vào hiện popup giải thích nhanh (như từ điển). Chia bảng theo phương pháp (Ichimoku, Price Action, Minervini…). Sau này dựa vào đây mở slide dạy phương pháp cho người mới."

All UI text Vietnamese. Owner date format dd/mm/yyyy. Do NOT change Python/ML code, report numbers, or table layout CSS. Claude is changing the `.report-scroll` / `.zone-alerts` widths in parallel on another branch, so touch only what this task needs.

**1. One data source, lesson-shaped** (`src/lib/glossary/`, pure TS, no React):
- `types.ts` defines three types:
  - `Source {label, href}`.
  - `Term {id, term, aliases, short, long, formula?, example?, sources, related}`:
    - `id`: kebab slug. It is used in URLs, so keep it stable.
    - `aliases: string[]`: the exact strings that appear in the UI, e.g. "POC", "Kijun-26", "VA thấp".
    - `short`: 1–2 sentences, ≤ 220 chars. This is the popup text.
    - `long: string[]`: paragraphs for the page or a slide.
    - `sources: Source[]`.
    - `related: string[]`: term ids.
  - `Group {id, name, summary, lesson, sources, terms}`:
    - `lesson: string[]`: a 3–6 bullet outline in teaching order, for future slides.
    - `sources: Source[]`.
    - `terms: Term[]`: in teaching order.
- One file per group. `index.ts` exports `GLOSSARY: Group[]`, `TERM_BY_ID`, `findTerm(alias)`.
- Groups, in teaching order, with their minimum terms:
  1. `co-ban` Cơ bản: phiên, nến ngày, giá đóng cửa, khối lượng (KL), KL / TB20, GTGD TB20, sàn (HOSE/HNX/UPCOM), giá nghìn đồng, thay đổi %.
  2. `xu-huong` Xu hướng & đường trung bình: MA (SMA), EMA, MA50/150/200, đỉnh/đáy sóng (pivot).
  3. `ho-tro-khang-cu` Hỗ trợ / Kháng cự: hỗ trợ, kháng cự, vùng (±0,5 ATR), vùng cảnh báo, chạm vùng, bật lại, phá vùng, khoảng cách ATR, khoảng cách %.
  4. `atr` Biến động: ATR14.
  5. `volume-profile` Volume Profile: POC, vùng giá trị (VA cao / VA thấp), cân bằng / mất cân bằng, lấy lại cân bằng, tích lũy quanh cân bằng, phá xác nhận / yếu / kiểm tra lại.
  6. `vwap` VWAP neo (Anchored VWAP).
  7. `ichimoku` Ichimoku: Kijun-sen (Kijun-26), Tenkan-sen, mây Kumo (Senkou A/B), Chikou. Explain that only Kijun is used in reports today.
  8. `price-action` Price Action & mô hình nến: every pattern name the app shows, plus nến trung tính and nến đảo chiều.
     - Candle names: read them from `ml/candles.py` PATTERNS (`name_vi`).
     - Chart patterns: read them from `ml/reports.py` `method_label` (Hai đỉnh, Hai đáy, Vai đầu vai, Cờ tăng/giảm, Tam giác…).
  9. `minervini` Minervini Trend Template: Trend Template, 8 tiêu chí, RS (1–99, our stand-in for IBD), giai đoạn 2, vừa đạt 8/8, vừa rớt khỏi.
  10. `macd` MACD: đường MACD, đường tín hiệu, histogram, cắt lên / cắt xuống, trên/dưới 0.
  11. `thong-ke` Thống kê & dự kiến: Dự kiến (mũi tên), Khả năng, Đến vùng kế tiếp, tỉ lệ đảo chiều, nền, n, khoảng tin cậy 95% (Wilson), OOS/IS, lift, PASS / EVIDENCE / chưa đạt chuẩn, BH (FDR), nhất quán, Wilson LB.
- Content: MOVE the existing texts into the glossary so there is one source of truth.
  - Move the TERMS in `src/components/reports/report-legend.tsx`.
  - Move the METHODS/SHARED entries (`how`, `why`, `sources`) in `src/components/backtest/zone-alerts.tsx`.
  - Both components must read from the glossary afterwards. Rendering the same text as today is fine.
  - Method facts must match `docs/METHODS.md` and the Python code. Read them; don't guess numbers (zone = 0.5 ATR, horizon 10 sessions, MIN_N 30, RS ≥ 70, etc.).
- Sources: use ONLY URLs already present in the repo (zone-alerts.tsx, report-legend.tsx, docs/METHODS.md). Never invent a URL. If a term has no source from those, leave `sources: []` and list it in the Result.

**2. Page `/thuat-ngu`** (`src/app/thuat-ngu/page.tsx`, same login gate as the other pages):
- A header and a search box. Search filters terms by term, aliases and short text, and is accent-insensitive ("ho tro" finds "hỗ trợ").
- Tabs or a left table of contents with one entry per group (owner: "chia bảng cho từng phương pháp").
- Each group shows its summary, its lesson outline, then a table or list of terms. Each term row shows the term and its short text, and expands to show long text, formula, example, sources and related links.
- Every term has an anchor `id={term.id}`. `/thuat-ngu#poc` scrolls to it and highlights it. `/thuat-ngu?nhom=ichimoku` opens that group.
- Add "Thuật ngữ" to the nav of `/reports`, `/backtest` and the dashboard sidebar.
- Works on desktop and at 390 px mobile, with no horizontal page overflow.

**3. Popup `<Term id="poc">POC</Term>`** (`src/components/glossary/term.tsx`):
- The term gets a dotted underline. Hover (desktop), focus (keyboard) or tap (touch) shows a small card with:
  - the term name;
  - the `short` text;
  - a "Xem chi tiết →" link to `/thuat-ngu#<id>`, opening in a new tab (`target=_blank rel=noopener`). Owner rule: never lose the list.
- Esc or a tap outside closes the card. Use `role="tooltip"` + `aria-describedby`.
- Render the card in a portal with `position: fixed`, clamped to the viewport. It must never be clipped by the overflow containers `.report-scroll` / `.zone-alerts-scroll`, and must never cause horizontal scroll.
- Helper `annotate(text): ReactNode` wraps known aliases found in plain text:
  - longest alias first, whole words only;
  - no nested wrapping;
  - only the first occurrence of each term per cell, to avoid clutter.

**4. Wire it in:**
- `/reports` column headers: every header whose column key maps to a term gets the popup.
  - The mapping lives in `src/lib/glossary/columns.ts` as `COLUMN_TERMS: Record<string, string>`. Examples:
    - signal→du-kien, chance→kha-nang, target→den-vung-ke-tiep;
    - poc→poc, value_low/value_high/valueArea→vung-gia-tri, vwap→vwap, kijun→kijun;
    - atr→atr, distance→khoang-cach-atr;
    - also volumeRatio, value, candle, history, rs, hit, lb, isHit, base, lift, net, fdr, status, consistent…
  - The header keeps its sort button, and the popup trigger must not break sorting. Use a separate small trigger, or put the label inside the button and call `stopPropagation` on the popup.
- `/reports` text: run `annotate` on the text columns `zone`, `event`, `candle`, `state`, `detail`, `targetLabel`, and on group notes and the report description.
- The legend (`report-legend.tsx`) shows its terms from the glossary, with a link to `/thuat-ngu`.
- `/backtest` lists (`zone-alerts.tsx`): headers and state/zone/candle cells use the same helpers. Method cards read from the glossary. Keep the `#pp-<key>` anchors working.

**5. Tests / evidence:**
- vitest `src/lib/glossary/glossary.test.ts` checks:
  - ids and aliases are unique (no alias belongs to two terms);
  - short is ≤ 220 chars;
  - every `related` id and every `COLUMN_TERMS` value exists;
  - every source href is https and appears in the allowed list (export it as `ALLOWED_SOURCES`);
  - every candle `name_vi` in ml/candles.py has a term (parse the .py file in the test).
- Component tests:
  - `Term`: hover and focus open the card, Esc closes it, the link opens in a new tab.
  - `annotate`: longest match wins, no double wrapping.
- Browser audit `scripts/glossary-audit.mjs`. Follow the Chrome CDP pattern of `scripts/reports-sticky-audit.mjs`.
  - Use YOUR dev server on port **3301** and Chrome debug port **9338**. Ports 3300/9337 belong to Claude, and 3200 is LIVE: never touch it.
  - Check /thuat-ngu at 1440 and 390: no overflow, search "ho tro" finds Hỗ trợ, `#poc` scrolls.
  - Check /reports?r=06: hovering a header shows the popup inside the viewport, not clipped.
  - Check the popup in the /backtest list.
  - Save screenshots to `docs/screenshots/glossary/`.
- `npm run lint`, `npx tsc --noEmit` and `npx vitest run` all pass.
- Dev setup:
  - DB: copy `D:/ActiveProject/StockVN-dev/data/stockpilot.sqlite` into the worktree's `data/`. Do not touch `D:/ActiveProject/StockVN/data`.
  - Start dev with `STOCKVN_API_TOKEN=reports-audit-token npx next dev -p 3301`.

**Result:** write `docs/G-1-RESULT.md` in the worktree with:
- files changed;
- term count per group;
- terms without a source;
- test output;
- the screenshot list;
- anything you are unsure about.

Commit on `codex/glossary`. Do not push, do not merge.

## Horizons (owner request 2026-11-11); StockVN repo

**Owner:** "Trên đây là phân tích nến ngày, là đầu tư trung hạn hay ngắn hạn? Tôi muốn có báo cáo cho Ngắn hạn, trung hạn và dài hạn (tương ứng nến ngày, tháng...). Sau này chỉ báo nào khớp cho cả ngắn, trung và dài hạn thì báo khẩn cấp trong 1 báo cáo."

### H-1 (StockVN, Claude, branch `claude/timeframes`, DONE): the core

Interface Codex builds on (read the code and docstrings):
- `ml/timeframes.py`:
  - `FRAMES` has three horizons:

    | Key | Name | Bars | Outcome window | Level look-back |
    |---|---|---|---|---|
    | D | Ngắn hạn | nến ngày | 10 phiên | 120 |
    | W | Trung hạn | nến tuần | 10 tuần | 120 |
    | M | Dài hạn | nến tháng | 10 tháng | 60 |

  - Each horizon has `name`, `bar`, `unit`, `horizon` and `lookback`.
  - `ORDER = ("D","W","M")`.
  - `resample(daily_g, frame)` returns that frame's bars. Columns stay the same. The last bar is the partial current week/month.
- `ml/zone_stats.py`:
  - `run(conn, symbols=None, frame="D")` writes rows next to the existing ones. Scope is `POOLED`/`<sym>` for D, and `W:POOLED`/`W:<sym>`, `M:...` for the others.
  - `lookup(..., frame=)` and `lookup_none(conn, symbol, frame)` read them.
  - CLI: `python -m ml.zone_stats --frame all`.
- `ml/forecast.py` `forecast(conn, symbol, daily_g, price=None, frame="D")`:
  - It resamples by itself and returns the same cells as before.
  - It also returns `forecastZone` and `forecastMove` (`bounce`|`break`|`base`).
  - `levels_now(g, lookback)`.
- `ml/zones.levels(g, lookback=120)`, `ml/ai_common.next_zones(g, lookback=120)`.
- `ml/consensus.py` `build(conn, fs, vn=None)` returns the **two groups of report 08** (Khẩn cấp).
  - Its input is the daily `fs` list of `ml.reports.run` (`[{"row": {...}, "g": daily}]`).
  - Columns: `symbol, signal(arrow), chance, D, W, M, close, change` for the zone group, and the same without chance for the MACD group.

### H-2 (StockVN, Codex, worktree D:/ActiveProject/StockVN-frames, branch `codex/timeframes` from `claude/timeframes`): reports per horizon + report 08 + UI

All UI text is Vietnamese. Dates are dd/mm/yyyy. Do NOT change the statistics rules in `ml/zone_stats.py`, `ml/forecast.py`, `ml/consensus.py` or `ml/timeframes.py`. If something there blocks you, write it in the Result instead.

1. **Report engine per horizon** (`ml/reports.py`):
   - `run(conn, only=None, frames=("D","W","M"))` computes:
     - D: everything as today (01–07), with the same keys "01".."07".
     - W and M: reports 01, 02, 03, 04 and 07, built on `timeframes.resample(g, frame)` with `lookback=timeframes.lookback(frame)` (pass it to `equilibrium.levels`, `next_zones` and anything else using 120 bars).
       - Store them under keys `W01..W04, W07, M01..M04, M07`.
       - Report 07 on W/M keeps only the MACD events: the Minervini Trend Template is defined on daily bars (MA50/150/200, 252 sessions). `ml/signal_report.py` needs a `frame` parameter, so that the history stats and targets use that frame's bars, its 10-bar outcome and its lookback.
       - 05 (validation) and 06 (intraday zones) stay D only.
     - Report "08" = `consensus.build(conn, fs)`, always (it needs the daily `fs`).
   - Forecast cells (Dự kiến / Khả năng / Đến vùng kế tiếp) in W/M reports use `forecast.forecast(..., frame=frame)`.
   - Payload: add `frame` ("D"/"W"/"M"; "08" uses "DWM"), `frameName` and `horizon` (the text from FRAMES).
   - Descriptions and notes must say the unit: "phiên" for D, "tuần" for W, "tháng" for M. For example, the 01 description "tăng so với 5 phiên trước" becomes "… 5 tuần trước" on W.
   - Registry titles stay the same.
   - Report 05's `history` and the `validation` texts stay D only.
2. **Pipeline** (`ml/pipeline.py`, daily branch):
   - After the existing zone_stats step, add W and M zone_stats (`zone_stats.run(conn, frame="W")`, then M).
   - The reports step runs all frames and 08.
   - Each new step is optional (try/except + "Bỏ qua bước …", like signals/charts), so a failure never stops the close messages.
   - Measure and report the added runtime in the Result.
3. **API**:
   - `/api/ai/reports/[key]` accepts `^(0[1-8]|[WM]0[1-7])$`.
   - The list endpoint returns every stored key with its frame.
   - Check `src/lib/ai/reports.ts` types (add `frame`, `frameName`, `horizon`).
4. **/reports UI**:
   - Top switch: **Ngắn hạn · nến ngày | Trung hạn · nến tuần | Dài hạn · nến tháng**, plus a separate red **⚠ Khẩn cấp · đồng thuận 3 khung (08)** tab, shown first when it has rows, with the row count.
   - URL: `/reports?h=W&r=01`. Old links `/reports?r=06` still work (h defaults to D).
   - Report tabs show only the reports that exist for the chosen horizon.
   - The header shows: horizon, bar type, outcome window (from `horizon`), and "Kỳ: <last session dd/mm/yyyy>".
   - Report 08 columns D/W/M are text cells (annotate them like other text cells).
   - Keep the sticky headers, the desktop no-horizontal-scroll rules, the new-tab symbol links and the glossary popups working for every horizon. Run the existing audits (`scripts/reports-sticky-audit.mjs`, `scripts/no-hscroll-audit.mjs`, `scripts/glossary-audit.mjs`) adapted to also cover W/M and 08.
5. **Glossary** (`src/lib/glossary/`): new group `khung-thoi-gian` "Khung thời gian đầu tư", first in teaching order after Cơ bản.
   - Terms: ngắn hạn, trung hạn, dài hạn, nến tuần, nến tháng, xu hướng chính / thứ cấp / phụ (Dow), Triple Screen (Elder, hệ số 5), đồng thuận 3 khung (báo cáo 08), Khẩn cấp.
   - Facts must come from the `ml/timeframes.py` and `ml/consensus.py` docstrings.
   - New allowed sources, both verified 2026-11-11. Add them to `ALLOWED_SOURCES`:
     - `https://chartschool.stockcharts.com/table-of-contents/market-analysis/dow-theory` (StockCharts ChartSchool — Dow Theory: primary moves last from a few months to many years, secondary moves from a few weeks to a few months, daily fluctuations usually not more than a week);
     - `https://chartschool.stockcharts.com/table-of-contents/chart-analysis/chart-types/elder-impulse-system` (StockCharts ChartSchool — Elder Impulse System, Elder's work).
   - No other new URLs.
   - Map the new columns: `D`/`W`/`M` → ngắn/trung/dài hạn.
6. **Tests/evidence**:
   - pytest covers: per-frame report keys and payload `frame`; W/M report 07 without Minervini; pipeline steps optional; API key regex.
   - vitest covers: the horizon switch and URL; glossary integrity (existing test).
   - `npm run lint`, `npx tsc --noEmit`, `npx vitest run` and `.venv` pytest all pass.
   - Dev DB: copy `D:/ActiveProject/StockVN-dev/data/stockpilot.sqlite`. It already has W/M zone stats; run `python -m ml.reports` there.
   - Dev server port **3301**, Chrome debug **9338** (3300/9337 are Claude's, 3200 is LIVE: never touch it).
   - Screenshots go to `docs/screenshots/horizons/`: D/W/M/08 at 1440 and 390.

**Result:** `docs/H-2-RESULT.md` with:
- files changed;
- row counts per report and frame on the dev DB;
- pipeline runtime added;
- test output;
- screenshots;
- anything you are unsure about.

Commit on `codex/timeframes`. Do not push, do not merge.

## Zalo log (owner request 2026-11-11); StockVN repo

**Owner:** "Hãy rút gọn luôn (tin Zalo), trên web thì hãy có màn hình lịch sử đầy đủ chú thích như trước. Và thêm mục log nội dung đã gửi zalo."

### Z-1 (StockVN, Claude, branch `claude/zalo-log`): compact messages + the log table

Every Zalo send writes one row per message part into `zalo_log`. The interface for Z-2:

```sql
CREATE TABLE IF NOT EXISTS zalo_log(
  id INTEGER PRIMARY KEY,
  sent_at TEXT NOT NULL,        -- ISO 8601 UTC
  vn_day TEXT NOT NULL,         -- YYYY-MM-DD, Vietnam time
  session TEXT,                 -- trading session the content is about (YYYY-MM-DD) or NULL
  kind TEXT NOT NULL,           -- see the list below
  symbols TEXT NOT NULL DEFAULT '',  -- comma list, e.g. 'CII,TCX'
  sent_text TEXT NOT NULL,      -- exactly what Zalo received (compact)
  detail TEXT NOT NULL DEFAULT '',   -- full explained version ("như trước"), newline separated; may be ''
  status TEXT NOT NULL DEFAULT 'sent' -- 'sent' | 'skipped_cap' | 'error'
);
```

`kind` values:
- `intraday`: price entered a zone during the session;
- `close`: zone status at the session close;
- `followup`: a candle pattern that was forming finished (or did not);
- `urgent`: report 08, Khẩn cấp;
- `command`: a reply to the owner's Zalo commands vung/ds/help;
- `legacy`: old trendline/model alerts;
- `other`.

Python helper: `ml/zalo_log.py` with `SCHEMA`, `record(conn, kind, sent_text, detail='', symbols=(), session=None, status='sent')` and `recent(conn, days=30, kind=None) -> list[dict]`.

### Z-2 (StockVN, Codex, worktree D:/ActiveProject/StockVN-zalolog, branch `codex/zalo-log`): web screen "Nhật ký Zalo"

All UI text is Vietnamese. Dates and times are dd/mm/yyyy HH:mm, Vietnam time. Do NOT touch any Python that sends Zalo messages (`ml/zone_messages.py`, `ml/consensus_zalo.py`, `ml/alerts.py`, `ml/zalo*.py`) or the statistics. Create `ml/zalo_log.py` ONLY if it does not exist yet. Claude writes it on another branch with the exact schema above. Your code must only read the table, and must treat a missing table as an empty log.

1. **API** `GET /api/ai/zalo-log`:
   - Same auth as `/api/ai/reports` (reuse its guard; read how the reports route opens the SQLite DB, through `src/lib/ai/*` / better-sqlite3).
   - Query params: `days` (default 14, max 90), `kind` (optional, one of the kinds), `q` (optional symbol filter, case-insensitive, matched on `symbols`).
   - Returns `{entries:[{id, sentAt, vnDay, session, kind, symbols:[...], sentText, detail, status}], kinds:{kind:count}}`, newest first, at most 500 entries.
2. **Page `/zalo`**, titled "Nhật ký Zalo". Add a nav link "Nhật ký Zalo" next to "Thuật ngữ" in /reports, /backtest and the dashboard sidebar.
   - Filters: kind chips with their counts (Vào vùng, Kết phiên, Theo dõi mô hình nến, Khẩn cấp, Trả lời lệnh, Cảnh báo cũ), a symbol search, and a day range (7 / 14 / 30 / 90 days).
   - Entries are grouped by day (newest first). Each entry shows: the time, a kind badge (Khẩn cấp is red), symbol chips (each one opens `/chart/<sym>` in a new tab, per the owner rule), and the exact `sentText` in a monospace "Tin đã gửi" box (`white-space: pre-wrap`).
   - The "Bản đầy đủ có chú thích" panel shows `detail`:
     - expandable, open by default for `close` and `urgent`;
     - every line runs through the glossary `annotate()` (`src/components/glossary/term.tsx`), so the terms get the hover popups;
     - when `detail` is empty, show "Tin này không có bản đầy đủ."
   - A status badge appears when status ≠ `sent`.
   - An empty state for when there are no rows.
   - Desktop: no horizontal scroll. Works at 390 px mobile.
3. **Glossary** (`src/lib/glossary/`): add these terms to an existing group, only if missing:
   - "Vào vùng";
   - "Kết phiên" (the close status the system sends after the daily bar);
   - "Giữ vùng / Đóng vượt vùng / Bật khỏi vùng". Check the Python `close_verdict` in `ml/zone_messages.py` for the exact verdict words and meanings, and use those words as aliases.
   - Do not add new URLs.
4. **Tests/evidence:**
   - vitest for the API: empty or missing table, filters, the limit.
   - vitest for the page: grouping, filter, detail panel.
   - Browser audit `scripts/zalo-log-audit.mjs`:
     - Use the Chrome CDP pattern of the existing audits, dev server port **3301**, Chrome debug **9338** (3300/9337 are Claude's, 3200 is LIVE: never touch it).
     - Seed the dev DB copy with ~12 realistic rows of each kind. Put the seed script in `scripts/seed-zalo-log.mjs` and run it on the worktree copy only.
     - Check 1440 and 390: no overflow, filters work, the popup works inside detail, the symbol link opens a new tab.
     - Save screenshots to `docs/screenshots/zalo-log/`.
   - `npm run lint`, `npx tsc --noEmit` and `npx vitest run` pass.
   - Dev DB: copy `D:/ActiveProject/StockVN-dev/data/stockpilot.sqlite`. Start with `STOCKVN_API_TOKEN=reports-audit-token npx next dev -p 3301`.

**Result:** `docs/Z-2-RESULT.md` with:
- files changed;
- test output;
- screenshots;
- anything you are unsure about.

Commit on `codex/zalo-log`. Do not push, do not merge.

## StockVN accounts via Zalo + Sân Khấu Online link (owner request 2026-11-13)

### U-2 (AllOnline, Codex, worktree `~/work/AllOnline-stockvnlink`, branch `codex/stockvn-link` from `master`)

Pair task: U-1 in the StockVN repo (`~/work/StockVN/docs/U-1-TASK.md`) — read its "Link endpoint"
section; that is the contract. Flow: a StockVN user answers CÓ on the StockVN bot and gets a 6-char
code; they open the Sân Khấu Online bot and send `SV <code>`; this bot confirms and calls StockVN.

Build (server/zalo/bot.ts command parser + handler, server/db.ts schema, tests in tests/zalo-bot.test.ts style):
1. Command `SV <code>` (also `STOCKVN <code>`; accents/case-insensitive; code A–Z/2–9, 6 chars).
   - Sender's bot identity (`zalo_oa`) must be linked to an account; otherwise reply how to get one:
     "Nhắn ĐĂNG KÝ để tạo tài khoản Sân Khấu Online (hoặc LK <mã> nếu đã có), rồi gửi lại SV <mã>."
   - Otherwise ask: "Liên kết tài khoản Sân Khấu Online «<display name>» với StockVN? Trả lời CÓ để xác
     nhận, KHÔNG để hủy (5 phút)." Keep the pending confirmation in memory or DB keyed by account
     (5 min; one pending per account). Make sure CÓ/KHÔNG do not collide with existing commands.
2. On CÓ: `POST ${STOCKVN_BASE_URL}/api/integrations/sankhau/link` (default `http://127.0.0.1:3200`
   on the VPS), `Authorization: Bearer ${SANKHAU_LINK_SECRET}`, body `{code, sankhauUserId, sankhauName}`,
   10 s timeout. 200 → store `stockvn_links(user_id unique, stockvn_user_id, linked_at)` (create in
   server/db.ts the same way other tables are created; upsert) and reply "Đã liên kết với StockVN.";
   404 → "Mã không đúng hoặc đã hết hạn, lấy mã mới ở bot StockVN (nhắn LIÊN KẾT)."; 409 → "Tài khoản
   StockVN này đã liên kết với tài khoản khác."; 429 → "Sai mã quá nhiều lần, lấy mã mới."; other/timeout →
   "StockVN chưa phản hồi, thử lại sau." Missing env → reply that the link is not configured, log it.
3. Account page (`src/app/account/page.tsx`): show "Đã liên kết StockVN" when a link exists (read via
   the existing account API; add the field there).
4. Help text: add `SV <mã> — liên kết với tài khoản StockVN`.
5. Tests with a fake fetch: not-linked sender, confirm/cancel/timeout, each HTTP outcome, help text.
   Run the repo's test/lint/typecheck commands; all must pass. Document `STOCKVN_BASE_URL`,
   `SANKHAU_LINK_SECRET` in docs/ZALO-BOT.md.

Do NOT deploy, do NOT touch `/srv`, no real Zalo/StockVN calls. Commit on `codex/stockvn-link`, do not
push; write `docs/U-2-RESULT.md` (what changed, test output, open questions).
