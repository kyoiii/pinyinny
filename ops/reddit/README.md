## Reddit Ops

Lightweight Reddit workflow for `拼音卡` promotion and feedback monitoring.

What it does:
- finds recent candidate threads in relevant subreddits
- scores likely opportunities
- drafts a small review queue
- monitors replies on tracked live comments
- posts a disclosed reply when run manually

What it does not do:
- mass-post automatically
- auto-reply without review
- hide affiliation

### Expected VM layout

These scripts are meant to run on the VM where `playwright` is already installed at `/tmp/reddit-ops`.

Recommended location on the VM:

`/home/nova/.openclaw/workspace/reddit-ops`

### Credentials

Set these in a private env file on the VM:

```sh
REDDIT_USERNAME=...
REDDIT_PASSWORD=...
```

For an always-on remote server, copy `.env.example` to `.env` and set:

```sh
REDDIT_USERNAME=...
REDDIT_PASSWORD=...
NODE_BIN=/usr/bin/node
PLAYWRIGHT_BROWSERS_PATH=0
```

### Commands

Search and rank recent opportunities:

```sh
node search-opportunities.mjs
```

Monitor replies on tracked live comments:

```sh
node monitor-feedback.mjs
```

Post a disclosed reply:

```sh
node post-reply.mjs --url "https://www.reddit.com/..." --text-file ./draft.txt
```

### Always-on remote server

The `deploy/` folder packages this worker for a Linux server with user-level `systemd`.

On the target server:

```sh
mkdir -p ~/apps
cd ~/apps
git clone <repo-url> pinyinka
cd pinyinka/ops/reddit
cp .env.example .env
# fill in REDDIT_USERNAME / REDDIT_PASSWORD / NODE_BIN
./deploy/install-remote.sh
```

This installs:
- `pinyinka-reddit-ops.service`
- `pinyinka-reddit-ops.timer`

The timer runs every 5 minutes and writes to:
- `cron.log`
- `out/opportunities.md`
- `out/feedback.md`

To keep a user-level timer alive after logout:

```sh
sudo loginctl enable-linger $USER
```

### GitHub Actions mode

If you want the worker off your Mac without provisioning a VPS, the repo also includes:

- `.github/workflows/reddit-ops.yml`

This scheduled workflow runs every 5 minutes and commits updated snapshots back into:

- `ops/reddit/out/`
- `ops/reddit/state/seen-replies.json`

Required GitHub Actions secrets:

```sh
REDDIT_USERNAME
REDDIT_PASSWORD
```

### Files

- `tracked-comments.json`: list of posted comment permalinks to monitor
- `out/opportunities.json`: machine-readable candidate queue
- `out/opportunities.md`: readable candidate queue
- `out/feedback.json`: machine-readable feedback snapshot
- `out/feedback.md`: readable feedback snapshot
