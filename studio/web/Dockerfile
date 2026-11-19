# The web editor's static server on Railway (service studio-web): Caddy serving the web build of one release, which it
# downloads from the public editor repository's releases (`DroneClean-Studio-web.tar.gz`, made by
# desktop/scripts/release-mac.mjs). The build is too big to upload from this Mac, and taking it from the release keeps
# the site, the app and the web editor on the same version. Deploy from this folder: `railway up --service studio-web`,
# with the service variable STUDIO_RELEASE set to the release's tag (for example v0.1.0).
FROM alpine:3.20 AS fetch
ARG STUDIO_RELEASE
RUN test -n "$STUDIO_RELEASE" || (echo "STUDIO_RELEASE (a release tag such as v0.1.0) is not set" >&2; exit 1)
RUN apk add --no-cache curl tar \
  && mkdir -p /srv/studio \
  && curl -fsSL "https://github.com/matteodante/droneclean-studio/releases/download/${STUDIO_RELEASE}/DroneClean-Studio-web.tar.gz" \
    | tar -xz -C /srv/studio \
  && test -f /srv/studio/index.html

FROM caddy:2.8-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=fetch /srv/studio /srv/studio
ENV PORT=8080
EXPOSE 8080
