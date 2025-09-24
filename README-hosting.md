Hosting guide — deploy to Firebase Hosting and map a custom subdomain

This guide shows how to deploy the app to Firebase Hosting and map a custom subdomain `fitness.franciscovaldez.com`.

Prerequisites
- You have a Firebase project and `firebase` CLI installed: `npm install -g firebase-tools`
- You're the owner or have access to the DNS configuration for `franciscovaldez.com`.

Steps
1) Build the app

```bash
npm run build
```

2) Initialize or configure Firebase Hosting

If you haven't initialized hosting in this repo yet:

```bash
firebase login
firebase init hosting
```

During `init`:
- Select the existing Firebase project you want to use.
- Set the public directory to `dist`.
- Configure as a single-page app? Yes.
- Do not overwrite your `index.html` if prompted.

If you already have `firebase.json` (this repo includes one), skip init.

3) Deploy manually

```bash
firebase deploy --only hosting
```

4) Map custom domain (fitness.franciscovaldez.com)
- In the Firebase Console → Hosting → Add Custom Domain.
- Enter `fitness.franciscovaldez.com` and follow the instructions.
- Firebase will give you DNS records (TXT + A/CNAME). Add those to your DNS provider for `franciscovaldez.com`.
- After validation, Firebase provisions a TLS certificate and your site will serve on the custom domain.

Notes about using a subpath instead of a subdomain
- If you prefer `franciscovaldez.com/fitness` instead of a subdomain, you'll need to either host the build under the main domain (e.g., copy `dist/` into the main host under `/fitness`) or setup a reverse proxy (Cloudflare Worker or your server) that proxies `/fitness` to the Firebase Hosting URL. Let me know if you need the Cloudflare Worker snippet.

CI (optional)
- You can add a GitHub Action to build and deploy automatically on pushes to `main` (see `.github/workflows/firebase-hosting.yml` in this repo as a template). You'll need to set `FIREBASE_TOKEN` as a repository secret (run `firebase login:ci` to get the token).

DNS steps for mapping a subdomain to Firebase Hosting (fitness.franciscovaldez.com)
1. In Firebase Console → Hosting → Add custom domain → enter `fitness.franciscovaldez.com`.
2. Firebase will display DNS records to add at your domain registrar. Typically this is either:
	- One or more A records pointing to Firebase IPs (if offered), or
	- CNAME record pointing to `ghs.googlehosted.com`.
3. Add the provided records at your DNS provider for the `fitness` record (subdomain).
4. Wait for DNS propagation and for Firebase to provision the TLS certificate (can take a few minutes to an hour).

If your domain is managed via Cloudflare and you experience certificate issues, ensure the Cloudflare proxy (orange cloud) is disabled for the firebase-provided verification records until validation completes.
Wed Sep 24 00:13:04 UTC 2025
