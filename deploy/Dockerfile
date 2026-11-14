# MIRA as one small container: Caddy + the built site (run `npm run build` in web/ first).
#   docker build -f deploy/Dockerfile -t mira . && docker run -p 8080:8080 mira
FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY web/dist /srv/mira
ENV SITE_ADDRESS=:8080 MIRA_ROOT=/srv/mira
EXPOSE 8080
