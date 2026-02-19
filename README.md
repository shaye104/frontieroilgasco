# Frontier Oil & Gas Company Website

Static, modular website for Frontier Oil & Gas Company:

- `index.html`: public landing page and company details
- `application.html`: candidate application form
- `intranet.html`: employee intranet login via Discord OAuth2 role-based access
- `voyage-tracker.html`: intranet placeholder page (protected)
- `my-fleet.html`: intranet placeholder page (protected)
- `my-details.html`: employee HR profile page
- `admin-panel.html`: admin-only operations hub
- `manage-employees.html`: admin employee management
- `access-requests.html`: admin access request approvals/denials
- `admin-config.html`: admin system configuration (statuses/types/ranks/grades/intranet roles)

## Project Structure

- `assets/css/`: design tokens, base styles, reusable components, page layouts
- `assets/js/modules/`: reusable JavaScript modules
- `assets/js/pages/`: page entry scripts
- `functions/api/auth/`: Cloudflare Pages Functions for Discord OAuth2 + session handling
- `scripts/update-webinfo.mjs`: auto-generates `WEBINFO.txt`
- `.githooks/pre-commit`: updates `WEBINFO.txt` before commits

## Local Workflow

1. Regenerate website handoff file:

```bash
npm run webinfo
```

2. Enable git hook once per local clone:

```bash
git config core.hooksPath .githooks
```

## GitHub Setup

```bash
git init
git branch -M main
git remote add origin https://github.com/shaye104/frontieroilgasco.git
git add .
git commit -m "Initial modular website scaffold"
git push -u origin main
```

## Cloudflare Deployment

1. Push updated code to GitHub.
2. In a Git-connected Pages project, use:
   - Build command: `echo static`
   - Build output directory: `.`
   - Deploy command (if required by your UI): `echo ok`
3. In Cloudflare, connect your custom domain and complete DNS routing.

## Discord OAuth2 Environment Variables (Pages Project)

Set these in Cloudflare Pages project settings:

- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `DISCORD_GUILD_ID`
- `DISCORD_BOT_TOKEN`
- `ADMIN_DISCORD_USER_ID` (Discord user ID that can manage intranet role access)
- `SESSION_SECRET` (long random secret string)
- `DISCORD_REDIRECT_URI` (optional override, default is `/api/auth/discord/callback`)

Also bind a D1 database to the Pages project as `DB`. Employee data, disciplinaries, notes, access requests, and config values are stored in D1.
