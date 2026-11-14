# MIRA as one small container: Caddy serves the built site; the optional assistant proxy runs beside it.
#   (run `npm run build` in web/ first)
#   docker build -f deploy/Dockerfile -t mira .
#   docker run -p 8080:8080 mira                                   # site only: the assistant reports itself unavailable
#   docker run -p 8080:8080 -e MIRA_LLM_KEY=... mira               # with the assistant
FROM caddy:2-alpine
RUN apk add --no-cache nodejs
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY web/dist /srv/mira
COPY web/server /opt/mira/web/server
COPY deploy/assistant-proxy.mjs /opt/mira/deploy/assistant-proxy.mjs
ENV SITE_ADDRESS=:8080 MIRA_ROOT=/srv/mira
EXPOSE 8080
CMD ["sh", "-c", "node /opt/mira/deploy/assistant-proxy.mjs & exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile"]
