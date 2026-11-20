# The web editor's static server

The editor also runs in the browser, published at `https://droneclean.app/studio/`. The live site (a Next.js app on
Railway) forwards `/studio/*` to this server over Railway's private network; this server holds nothing but the
editor's static build.

## Build

```sh
cd studio
npm run build:web          # STUDIO_BASE_PATH=/studio/, into dist-web/ (the desktop's dist/ is untouched)
npm run check:web-base     # serves dist-web/ under /studio/ in headless Chrome and checks it (builds first; --skip-build reuses dist-web/)
```

## Image and deploy

The web build is too big to upload from this Mac (Railway answers 413 for 332 MB), so the release carries it:
`desktop/scripts/release-mac.mjs` builds `dist-web/` and publishes `DroneClean-Studio-web.tar.gz` (no source maps) with
the Mac app. The `Dockerfile` here downloads that file for one release tag and serves it with Caddy. After a release:

```sh
# service studio-web of the DroneClean project, variable STUDIO_RELEASE = the release's tag (for example v0.1.0)
railway up --service studio-web     # from this folder: only the Dockerfile and the Caddyfile are uploaded
cd .. && npm run check:live-web     # once it is deployed: the live editor lands on its projects, isolated, no worker
```

`Caddyfile`: listens on `:$PORT` bound to `[::]` (Railway's private network is IPv6); every response carries
`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp` and
`Cross-Origin-Resource-Policy: same-origin`; unknown routes under `/studio/` answer `index.html`; files under
`/studio/assets/` are cached for a year, everything else is revalidated; `/health` answers 200.
