# Zalo Bot Platform

T-1 replaces the OA bot transport. OAuth app login and SePay are separate and unchanged.
The OA bot setup in ZALO-SEPAY.md is superseded by this document.

## Configuration and public link

- `ZALO_BOT_TOKEN`: Bot Creator token. Production bot availability depends on this token.
- `ZALO_BOT_WEBHOOK_SECRET`: 8–256 characters, matching the registered webhook secret.
- `ZALO_BOT_ID`: optional legacy setting; startup resolves `getMe.account_name` with the token,
  so an old numeric value cannot produce a numeric public URL. Discovery runs in the
  background; failures leave botInfo null and retry every five minutes until successful.

The selected public link is `https://zalo.me/bot.JwUidOjZ`, using the supplied
`account_name`, rather than the API id `3431386737049524427`. This choice is inferred from
the distinction between API id and account name; the official getMe page documents both
fields but does not specify the public-link format. Anonymous desktop probes of both URLs
redirected to Zalo login, and mobile probes redirected to the app store. They cannot prove
which chat opens. A check on a device signed into Zalo remains necessary before rollout.
Tests lock in the account-name choice but are not evidence of Zalo client behavior.

## Transport and webhook

Current official documentation (checked 2026-11-08):

- [getMe](https://bot.zapps.me/docs/apis/getMe/)
- [sendMessage](https://bot.zapps.me/docs/apis/sendMessage/)
- [Webhook payloads](https://bot.zapps.me/docs/webhook/)
- [setWebhook](https://bot.zapps.me/docs/apis/setWebhook/)

These pages now specify `https://bot-api.zaloplatforms.com/bot<TOKEN>/<method>`,
superseding the `bot-api.zapps.me` host in the original task notes.
Messages use `chat_id` and `text`. The webhook is
`POST /api/zalo/bot-webhook`; it compares fixed-length SHA-256 digests of
`X-Bot-Api-Secret-Token` and the configured secret using `timingSafeEqual`.
Missing or incorrect secrets return 401 before reading the body. Only private messages
from human senders enter account commands. Text and image events use the documented
`message.text.received` / `message.image.received` payloads. Validated requests are
acknowledged with HTTP 200 before background handling; failures are logged without provider
details. The documented `message.message_id`, when present, suppresses duplicates within
this process for 24 hours (up to 20,000 entries); this cache does not survive restarts or
coordinate multiple server processes. Events without IDs are processed independently.
`from.id` identifies the account, `from.display_name` names new accounts, and `chat.id`
is the destination for immediate replies. Image downloads time out after 15 seconds and
reject bodies over 8 MiB, checking Content-Length before reading and enforcing the limit
while streaming when the length is absent or inaccurate.

The existing `zalo_oa` identity key is retained to avoid a database migration. Bot Platform
ids are not automatically mapped to previous OA followers or OAuth identities; users can
link their existing web account with `LK <code>`. OA token refresh, signatures and the old
`/api/zalo/webhook` endpoint have been removed.

## Explicit webhook registration

The server never registers a webhook automatically. Supply the token and secret through
the operator's process environment, then run:

```powershell
npx.cmd tsx scripts/zalo-set-webhook.ts
```

This is a dry run. An operator can append `--apply` to call setWebhook for
`https://sankhau.pro.vn/api/zalo/bot-webhook`. The script deliberately does not load
`.env.local`, never prints credentials and reports failed provider verification even when
the webhook URL was saved. No live registration was performed for T-1.

## Demo verification

Demo mode always uses CaptureSender, even if bot credentials are inherited. The simulator
and login tab are available without credentials, with a placeholder `demo-bot` link.
The tests use an in-memory PGlite database, a temporary loopback HTTP API server (no Next
server or tunnel), and mocked outbound Bot API requests:

```powershell
npx.cmd vitest run tests/zalo-bot.test.ts tests/zalo-pay.test.ts --silent
npm.cmd run lint
npx.cmd tsc --noEmit
```

### Liên kết StockVN (SV)

Người đã có tài khoản Sân Khấu Online gắn với danh tính bot gửi
`SV <mã>` (hoặc `STOCKVN <mã>`) rồi trả lời CÓ trong 5 phút; KHÔNG hủy yêu cầu.
Mã lấy từ bot StockVN bằng lệnh LIÊN KẾT. Mỗi tài khoản có một yêu cầu chờ;
mã mới thay mã cũ. Yêu cầu chờ lưu trong bộ nhớ, mất khi khởi động lại.

Cấu hình phía server (không đưa vào biến NEXT_PUBLIC):
- `STOCKVN_BASE_URL`: địa chỉ StockVN, mặc định `http://127.0.0.1:3200`.
- `SANKHAU_LINK_SECRET`: bí mật dùng chung với StockVN cho bearer auth.
  Nếu thiếu, bot báo chưa cấu hình và không gửi HTTP.

Sau xác nhận, server POST `/api/integrations/sankhau/link` với timeout 10 giây.
Thành công lưu liên kết vào `app.stockvn_links`; trang Tài khoản hiển thị
“Đã liên kết StockVN”. Không tự thử lại: nếu lỗi hoặc hết hạn xác nhận,
người dùng gửi lại SV; nếu mã StockVN đã dùng/hết hạn, lấy mã mới ở bot StockVN.
