FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* tsconfig.json ./
RUN npm ci
COPY src/ ./src/
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 viddey

RUN mkdir -p /tmp/viddey-uploads \
 && chown viddey:nodejs /tmp/viddey-uploads

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./

USER viddey

ENV NODE_ENV=production \
    PORT=3001 \
    HOST=0.0.0.0 \
    UPLOAD_TEMP_DIR=/tmp/viddey-uploads

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["node", "dist/index.js"]
