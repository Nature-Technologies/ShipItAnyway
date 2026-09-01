FROM mcr.microsoft.com/playwright:v1.59.1-jammy AS base

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json ./backend/package.json

RUN corepack enable && pnpm install --frozen-lockfile --filter backend --ignore-scripts

COPY backend/ ./backend/
COPY .env.example .env

ENV DATABASE_URL=postgresql://postgres:postgres@localhost:5432/playwright_testing
ENV PLAYWRIGHT_BROWSERS_PATH=0

RUN cd backend && npx prisma generate
RUN cd backend && npx playwright install chromium webkit

RUN mkdir -p /app/backend/screenshots /app/backend/traces

# Pin the container to UTC so an unset Schedule.timezone fires deterministically in UTC.
ENV TZ=UTC

# ── dev target: tsx watch + Node inspector, no compile. Source is bind-mounted at
# runtime (see docker-compose.debug.yml) so file changes restart the process. ──────
FROM base AS dev
ENV NODE_ENV=development
# tsx uses chokidar; bind mounts on Windows/macOS need polling to see host writes.
ENV CHOKIDAR_USEPOLLING=true
EXPOSE 3000 9229
CMD sh -c "cd backend && npx prisma migrate deploy && npx prisma db seed && npx tsx watch --inspect=0.0.0.0:9229 src/index.ts"

# ── prod target (default: last stage): compile then run the built JS. ──────────────
FROM base AS prod
RUN cd backend && npx tsc -p tsconfig.json && npx tsc-alias -p tsconfig.json
EXPOSE 3000
# TypeScript output lives under dist/src because the backend tsconfig compiles from src/.
CMD sh -c "cd backend && npx prisma migrate deploy && npx prisma db seed && node dist/src/index.js"
