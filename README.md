# Frontier Oil & Gas Company Website

Static, modular website for Frontier Oil & Gas Company with three pages:

- `index.html`: public landing page and company details
- `application.html`: candidate application form
- `intranet.html`: employee intranet login (demo front-end behavior)

## Project Structure

- `assets/css/`: design tokens, base styles, reusable components, page layouts
- `assets/js/modules/`: reusable JavaScript modules
- `assets/js/pages/`: page entry scripts
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
2. In Cloudflare dashboard, open **Workers & Pages** and create a new **Pages** project.
3. Connect GitHub and select `shaye104/frontieroilgasco`.
4. Build settings:
   - Framework preset: `None`
   - Build command: *(leave blank)*
   - Build output directory: `.`
5. Deploy the project.
6. In the Pages project, add your custom domain and complete DNS routing in Cloudflare.
