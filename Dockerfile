# Cloudflare Single Email Viewer — runtime image.
# Zero runtime dependencies, so this is tiny and fast to build.
FROM node:22-alpine

# Run as the built-in non-root user for safety.
ENV NODE_ENV=production
WORKDIR /app

# Only what the server needs at runtime.
COPY package.json ./
COPY server.js ./
COPY lib ./lib
COPY public ./public

EXPOSE 3000

# Basic container healthcheck against the liveness endpoint.
HEALTHCHECK --interval=30s --timeout=4s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER node

CMD ["node", "server.js"]
