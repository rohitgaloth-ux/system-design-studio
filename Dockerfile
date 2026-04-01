# ── Stage 1: build the Vite frontend ─────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build


# ── Stage 2: production runtime ──────────────────────────────
FROM node:20-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

# Copy built frontend and server files from builder
COPY --from=builder /app/dist   ./dist
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/src    ./src

EXPOSE 8080 4173

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "const p=process.env.PORT||4173;fetch('http://127.0.0.1:'+p+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--import", "tsx", "server.ts"]
