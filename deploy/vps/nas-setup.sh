#!/bin/bash
# NAS cá nhân trên VPS mhc-vps: WireGuard VPN + ổ mạng SMB CHỈ mở bên trong VPN.
# Chạy từ máy PC (Git Bash):   ssh vps 'bash -s' < deploy/vps/nas-setup.sh
# Chạy lại nhiều lần an toàn: khóa đã có thì giữ nguyên (riêng mật khẩu SMB thì tạo mới).
#
# Kết quả:
#   - VPN 10.66.0.0/24: VPS = 10.66.0.1, PC = 10.66.0.2, điện thoại = 10.66.0.3 (UDP 51820)
#   - Ổ mạng \\10.66.0.1\nas  (user: nas) -> /srv/nas/{chung,claude,backup}
#   - File xóa qua SMB vào /srv/nas/.thung-rac (thùng rác)
#   - Cấu hình client: /etc/wireguard/clients/{pc,phone}.conf ; mật khẩu SMB: /etc/wireguard/clients/smb-password.txt
set -e
export DEBIAN_FRONTEND=noninteractive
apt-get install -y -qq wireguard samba qrencode >/dev/null
umask 077; mkdir -p /etc/wireguard/clients; cd /etc/wireguard
[ -f server.key ] || { wg genkey > server.key; wg pubkey < server.key > server.pub; }
for n in pc phone; do
  [ -f clients/$n.key ] || { wg genkey > clients/$n.key; wg pubkey < clients/$n.key > clients/$n.pub; wg genpsk > clients/$n.psk; }
done
cat > wg0.conf <<C
[Interface]
Address = 10.66.0.1/24
ListenPort = 51820
PrivateKey = $(cat server.key)

[Peer]
# PC
PublicKey = $(cat clients/pc.pub)
PresharedKey = $(cat clients/pc.psk)
AllowedIPs = 10.66.0.2/32

[Peer]
# phone
PublicKey = $(cat clients/phone.pub)
PresharedKey = $(cat clients/phone.psk)
AllowedIPs = 10.66.0.3/32
C
for c in pc:2 phone:3; do n=${c%:*}; ip=${c#*:}; cat > clients/$n.conf <<C
[Interface]
PrivateKey = $(cat clients/$n.key)
Address = 10.66.0.$ip/32

[Peer]
PublicKey = $(cat server.pub)
PresharedKey = $(cat clients/$n.psk)
Endpoint = 103.175.248.207:51820
AllowedIPs = 10.66.0.0/24
PersistentKeepalive = 25
C
done
systemctl enable wg-quick@wg0 >/dev/null 2>&1; systemctl restart wg-quick@wg0
ufw allow 51820/udp >/dev/null
ufw allow in on wg0 to any port 445 proto tcp >/dev/null

# Thư mục NAS
id nas >/dev/null 2>&1 || useradd -M -s /usr/sbin/nologin -d /srv/nas nas
mkdir -p /srv/nas/chung /srv/nas/claude /srv/nas/backup
chown -R nas:nas /srv/nas; chmod 2775 /srv/nas /srv/nas/chung /srv/nas/claude /srv/nas/backup
PW=$(openssl rand -base64 18 | tr -d "/+=" | cut -c1-16)
printf "%s\n%s\n" "$PW" "$PW" | smbpasswd -s -a nas >/dev/null; smbpasswd -e nas >/dev/null
echo "$PW" > /etc/wireguard/clients/smb-password.txt

cat > /etc/samba/smb.conf <<C
[global]
   server string = mhc-vps NAS
   interfaces = 127.0.0.1 10.66.0.1/24
   bind interfaces only = yes
   hosts allow = 10.66.0.0/24 127.0.0.1
   server min protocol = SMB3
   smb encrypt = desired
   map to guest = never
   disable netbios = yes
   smb ports = 445
   load printers = no
   printing = bsd
   printcap name = /dev/null
   log file = /var/log/samba/%m.log
   max log size = 1000

[nas]
   path = /srv/nas
   valid users = nas
   read only = no
   force user = nas
   force group = nas
   create mask = 0664
   directory mask = 2775
   vfs objects = recycle
   recycle:repository = .thung-rac
   recycle:keeptree = yes
   recycle:versions = yes
C
testparm -s >/dev/null 2>&1 && echo "smb.conf OK"
systemctl disable --now nmbd >/dev/null 2>&1 || true
# smbd phải khởi động SAU VPN, nếu không sẽ không nghe được trên 10.66.0.1 sau khi reboot
mkdir -p /etc/systemd/system/smbd.service.d
printf "[Unit]\nAfter=wg-quick@wg0.service\nWants=wg-quick@wg0.service\n" > /etc/systemd/system/smbd.service.d/after-wg.conf
systemctl daemon-reload
systemctl enable smbd >/dev/null 2>&1; systemctl restart smbd
sleep 1
wg show wg0 | head -3
ss -tlnp | grep "10.66.0.1:445" || echo "CANH BAO: smbd chua nghe cong 445"
ufw status | grep -E "51820|445"
echo "XONG. Lay cau hinh PC:  ssh vps cat /etc/wireguard/clients/pc.conf"
