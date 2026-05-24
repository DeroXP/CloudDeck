# Production image for the CloudDeck Railway app.
#
# The agent is NOT containerized — it runs natively on Windows. The Pi
# forwarder is not containerized either (it needs broadcast access to the
# host's LAN, which is friction inside Docker). This image is for the
# Railway-side web app only.

FROM node:20-alpine AS deps
WORKDIR /app
COPY client/package.json client/package-lock.json* ./client/
RUN cd client && npm install --omit=dev --no-audit --no-fund

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV DATA_DIR=/data

# Non-root user for the app
RUN addgroup -S app && adduser -S -G app app

COPY --from=deps /app/client/node_modules ./client/node_modules
COPY client ./client
COPY .env.example ./

# Persistent storage for users.json, sessions.json, etc.
#
# NOTE: we deliberately do NOT declare `VOLUME /data` here — Railway rejects
# Dockerfiles that use the VOLUME directive ("use Railway Volumes" error at
# build time). Instead create the directory and rely on the Railway-managed
# volume being mounted at /data at runtime. For docker-compose / local
# runs the named volume in docker-compose.yml covers the same purpose.
RUN mkdir -p /data && chown -R app:app /data /app

USER app

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=4s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/api/health || exit 1

WORKDIR /app/client
CMD ["node", "server.js"]
