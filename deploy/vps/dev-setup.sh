#!/bin/bash
# Môi trường làm việc trên VPS cho VS Code Remote-SSH (user cuong).
# Chạy từ PC (Git Bash), thư mục repo AllOnline:   ssh vps 'bash -s' < deploy/vps/dev-setup.sh
# Chạy lại an toàn.
#
#  - user cuong (sudo không mật khẩu, nhóm sankhau để đọc log/dữ liệu app), đăng nhập bằng các khóa SSH đang vào root
#  - code làm việc: /home/cuong/work/{AllOnline,StockVN}  (site thật vẫn chạy ở /srv/*, chỉ đổi khi deploy)
#  - bộ nhớ Claude Code: lấy từ NAS /srv/nas/claude/claude-memory
set -e
export DEBIAN_FRONTEND=noninteractive
U=cuong
apt-get install -y -qq gh >/dev/null

id $U >/dev/null 2>&1 || useradd -m -s /bin/bash -G sankhau $U
echo "$U ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/90-$U
chmod 440 /etc/sudoers.d/90-$U
visudo -cf /etc/sudoers.d/90-$U >/dev/null

install -d -m 700 -o $U -g $U /home/$U/.ssh
grep -v '^#' /root/.ssh/authorized_keys | grep . > /home/$U/.ssh/authorized_keys
chown $U:$U /home/$U/.ssh/authorized_keys
chmod 600 /home/$U/.ssh/authorized_keys

install -d -o $U -g $U /home/$U/work
if [ ! -d /home/$U/work/AllOnline/.git ]; then
  sudo -u $U git clone -q https://github.com/goixe5sao/AllOnline.git /home/$U/work/AllOnline
fi
sudo -u $U git -C /home/$U/work/AllOnline config user.name "Mac Huy Cuong"
sudo -u $U git config --global init.defaultBranch master
sudo -u $U git config --global pull.ff only

# Bộ nhớ Claude Code: slug của /home/cuong/work/AllOnline là -home-cuong-work-AllOnline
MEM=/home/$U/.claude/projects/-home-cuong-work-AllOnline/memory
if [ -d /srv/nas/claude/claude-memory/d--ActiveProject-AllOnline ] && [ ! -f $MEM/MEMORY.md ]; then
  install -d -o $U -g $U /home/$U/.claude /home/$U/.claude/projects /home/$U/.claude/projects/-home-cuong-work-AllOnline $MEM
  cp /srv/nas/claude/claude-memory/d--ActiveProject-AllOnline/* $MEM/
  chown -R $U:$U /home/$U/.claude
fi

# Lối tắt tới ổ NAS trong thư mục làm việc
[ -e /home/$U/nas ] || ln -s /srv/nas /home/$U/nas
usermod -aG nas $U

echo "OK. Tiep theo (trong VS Code Remote-SSH, terminal cua user $U):"
echo "  gh auth login        # dang nhap GitHub (StockVN la repo private)"
echo "  gh repo clone goixe5sao/StockVN ~/work/StockVN"
echo "  cd ~/work/AllOnline && npm ci"
