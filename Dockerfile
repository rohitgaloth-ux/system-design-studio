# ── Stage 1: build the Vite frontend ─────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

# Install build tools required by better-sqlite3 (native module)
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build


# ── Stage 2: production runtime ──────────────────────────────
FROM node:20-slim AS runner

WORKDIR /app

# Runtime build tools (better-sqlite3 needs them at install time)
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

# Copy built frontend and server files from builder
COPY --from=builder /app/dist   ./dist
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/src    ./src

# Persistent volume for the SQLite database
RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 8080 4173

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "const p=process.env.PORT||4173;fetch('http://127.0.0.1:'+p+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--import", "tsx", "server.ts"]
