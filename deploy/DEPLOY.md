# Deploy GiveGet v0 to a VPS

Step-by-step setup on a fresh Debian 12 or Ubuntu 24.04 VPS.

Recommended: **Hetzner CX22** (~€4.50/month, 4GB RAM, 40GB disk, Falkenstein DE).

## 0. DNS first

Point your domain (e.g. `giveget-test.xyz`) to your VPS IP. Wait a few minutes for propagation.

## 1. Create a non-root user

```sh
ssh root@YOUR_VPS_IP

adduser giveget
usermod -aG sudo giveget
mkdir -p /home/giveget/.ssh
cp ~/.ssh/authorized_keys /home/giveget/.ssh/
chown -R giveget:giveget /home/giveget/.ssh

# Lock down SSH (optional but recommended)
# Edit /etc/ssh/sshd_config: PermitRootLogin no, PasswordAuthentication no
systemctl restart sshd

exit
ssh giveget@YOUR_VPS_IP
```

## 2. Firewall

```sh
sudo apt update && sudo apt install -y ufw
sudo ufw allow OpenSSH
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
```

## 3. Install Bun

```sh
curl -fsSL https://bun.sh/install | bash
echo 'export BUN_INSTALL="$HOME/.bun"' >> ~/.bashrc
echo 'export PATH="$BUN_INSTALL/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
bun --version  # confirm
```

## 4. Install Caddy

```sh
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

## 5. Get the code

If you have a private git repo:
```sh
cd ~
git clone YOUR_REPO_URL app
cd app
bun install
```

Or copy via scp from your laptop:
```sh
# from your laptop
scp -r ./v0 giveget@YOUR_VPS_IP:/home/giveget/app
# on the VPS
cd ~/app && bun install
```

## 6. Test it runs

```sh
cd ~/app
bun run start
# In another shell: curl http://localhost:3000/about
# Should return HTML. Ctrl-C to stop.
```

## 7. Install systemd unit

```sh
sudo cp deploy/giveget.service /etc/systemd/system/giveget.service
sudo systemctl daemon-reload
sudo systemctl enable --now giveget
sudo systemctl status giveget
sudo journalctl -u giveget -f   # tail logs
```

## 8. Configure Caddy

```sh
# Edit /etc/caddy/Caddyfile — start from the example:
sudo cp deploy/Caddyfile.example /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile     # replace giveget.example.com with your real domain
sudo systemctl reload caddy
```

Visit `https://your-domain` — Caddy gets a Let's Encrypt cert automatically the first time.

## 9. Bootstrap yourself as coordinator

```sh
# Visit https://your-domain/ in a browser, pick a nickname (e.g. "Maros"), submit.
# Then:
sudo apt install -y sqlite3
sqlite3 ~/app/data/giveget.db "UPDATE users SET is_coordinator = 1, is_vouched = 1 WHERE nickname = 'Maros';"
# Reload the page — you'll now see "Coordinator" in the nav.
```

## 10. Schedule the listing-expiry job

```sh
crontab -e
# Add this line:
0 * * * * cd /home/giveget/app && /home/giveget/.bun/bin/bun run expire >> /home/giveget/expire.log 2>&1
```

## 11. Nightly backup to your laptop

On **your laptop** (not the VPS):

```sh
# Add to a daily cron or a launchd plist:
rsync -avz --delete giveget@YOUR_VPS_IP:/home/giveget/app/data/ ~/giveget-backups/$(date +%F)/
```

For Windows, use WSL with rsync, or `scp -r` in a scheduled task.

## 12. Sanity smoke test

- [ ] Open `https://your-domain/` in incognito → see signup form
- [ ] Pick a test nickname (e.g. `test1`) → redirected to feed
- [ ] Create one offer listing with a photo → photo visible
- [ ] In a second browser, sign up as `test2`
- [ ] Claim the offer, exchange messages, both click Agree, both click Confirm
- [ ] On both `/me` pages, tally now shows Given/Received +1 each (one side gave, one received)
- [ ] Coordinator (you, signed in as your real nickname) sees the test exchange in `/coord`
- [ ] Delete test users via sqlite when done

## 13. Update later

```sh
cd ~/app
git pull          # or scp the new files
bun install
sudo systemctl restart giveget
```

## What you have now

- One Bun process running on `localhost:3000`
- Caddy in front terminating TLS with auto-renewing Let's Encrypt cert
- SQLite file at `~/app/data/giveget.db`
- Photos at `~/app/data/photos/`
- Listings auto-expire hourly via cron
- Backed up nightly to your laptop via rsync

Total cost: ~€4.50/month for the VPS + ~€10/year for the domain. That's it.
