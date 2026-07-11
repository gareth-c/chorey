# --- client build ---
FROM node:20-alpine AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm install
COPY client/ ./
RUN npm run build

# --- server dependencies (prod only, for the final image) ---
FROM node:20-alpine AS server-deps
RUN apk add --no-cache python3 make g++
WORKDIR /app/server
COPY server/package*.json ./
RUN npm install --omit=dev

# --- server build ---
FROM node:20-alpine AS server-build
RUN apk add --no-cache python3 make g++
WORKDIR /app/server
COPY server/package*.json ./
RUN npm install
COPY server/ ./
RUN npm run build

# --- final runtime image ---
FROM node:20-alpine
WORKDIR /app

ENV NODE_ENV=production \
    PORT=5152 \
    DATA_DIR=/app/data

COPY --from=server-deps /app/server/node_modules ./node_modules
COPY --from=server-build /app/server/dist ./dist
COPY --from=client-build /app/client/dist ./public

# Baked in at build time so GET /api/version matches exactly what's running.
COPY version.json ./version.json

RUN mkdir -p /app/data

EXPOSE 5152
VOLUME ["/app/data"]

CMD ["node", "dist/index.js"]
