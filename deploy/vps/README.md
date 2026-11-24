# VPS extras (outside the app deploy)

Services set up by hand on the VPS that `deploy/linux/install.sh` does not cover.
Addresses, keys and per-device details are kept on the VPS and in the owner's private notes, not in this public repo.

## WireGuard `wg0`

- `nas-setup.sh`: the owner's PC/phone reach the VPS SMB share over WireGuard.
- `qnap-setup.sh`: the home QNAP joins `wg0` and may only read the backup rsync module (pull-only backup).
  The NAS pulls `/var/backups/sankhau/daily` nightly, never deletes, verifies `SHA256-*`, and snapshots its volume.
- Family phones get their own peers that can reach only the NAS web port (forwarded through the VPS with
  `ufw route allow`); they are denied every VPS service.

## Vaultwarden — family password manager

- Binary + web vault extracted from the official `vaultwarden/server:<version>-alpine` image (static build,
  no Docker on the VPS) into `/opt/vaultwarden`; `vaultwarden.service` listens on 127.0.0.1 only, env in
  `/etc/vaultwarden.env` (signups off, invitations on, admin token stored as an argon2 hash).
- Published through the existing Cloudflare tunnel (ingress entry + proxied CNAME).
- Data `/srv/vaultwarden/data` → nightly `vaultwarden-<stamp>.tar.zst` in `deploy/linux/backup.sh`
  (local 7 days, R2, home NAS). Vault items are end-to-end encrypted by the Bitwarden clients.
- Upgrade: extract the new image's `/vaultwarden` and `/web-vault`, replace `/opt/vaultwarden`, restart the service.
