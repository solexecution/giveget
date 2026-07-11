# GiveGet v0

Pre-MVP barter platform for Town Ranch. Single self-hosted web page, zero external user dependencies.

## Stack

- **Runtime:** Bun
- **Web:** Hono
- **DB:** SQLite (`bun:sqlite`)
- **Frontend:** Plain HTML forms, zero JS
- **CSS:** Pico.css (classless)
- **Images:** sharp (resize on upload)
- **Sessions:** HTTP cookie (no JS)

## Run locally

```sh
bun install
bun run dev
# open http://localhost:3000
```

## Deploy

See [`deploy/DEPLOY.md`](deploy/DEPLOY.md).

## Project layout

```
src/
  server.ts        # Hono app + route mounting
  db.ts            # SQLite schema + helpers
  session.ts       # Cookie-based session
  views.ts         # HTML rendering helpers + layouts
  images.ts        # Photo upload + resize
  routes/
    browse.ts      # Landing / listing feed
    listings.ts    # Create / view listings
    claims.ts      # Claim / message / agree / confirm
    profile.ts     # My profile / other user
    coord.ts       # Coordinator panel + vouch + goodwill
  jobs/
    expire.ts      # Mark old listings expired (run via cron)

data/
  giveget.db       # SQLite (gitignored)
  photos/          # Uploaded photos (gitignored)

public/            # Static (currently nothing — pico.css served from node_modules)

deploy/
  Caddyfile.example
  giveget.service  # systemd unit
  DEPLOY.md        # step-by-step VPS setup
```

## Bootstrap a coordinator

After first run, the database exists but has no users. To bootstrap yourself as coordinator:

1. Visit `http://localhost:3000` and pick your nickname.
2. Run `sqlite3 data/giveget.db "UPDATE users SET is_coordinator = 1, is_vouched = 1 WHERE nickname = 'YourNickname';"`.
3. Reload — you'll now see `/coord` in the nav.

That's it. From then on, you vouch every new member from the coordinator panel.
