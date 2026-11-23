FROM node:22-alpine AS builder
WORKDIR /app

# 1. Build shared-types
COPY packages/shared-types ./packages/shared-types
RUN cd packages/shared-types && npm ci && npm run build

# 2. Install & build backend
COPY backend/package*.json ./backend/
RUN cd backend && npm ci
COPY backend ./backend
RUN cd backend && npm run build

# 3. Runtime stage
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/packages/shared-types/package.json ./packages/shared-types/package.json
COPY --from=builder /app/packages/shared-types/dist ./packages/shared-types/dist

COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev

COPY --from=builder /app/backend/dist ./backend/dist
COPY database/migrations ./database/migrations

RUN mkdir -p /app/backend/storage/attachments

WORKDIR /app/backend
EXPOSE 3001
CMD ["node", "dist/main.js"]
