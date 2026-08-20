FROM mcr.microsoft.com/playwright:v1.59.1-jammy

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json ./backend/package.json

RUN corepack enable && pnpm install --frozen-lockfile --filter backend --ignore-scripts

COPY backend/ ./backend/
COPY .env.example .env

ENV DATABASE_URL=postgresql://postgres:postgres@localhost:5432/playwright_testing
ENV PLAYWRIGHT_BROWSERS_PATH=0

RUN cd backend && npx prisma generate
RUN cd backend && npx tsc -p tsconfig.json
RUN cd backend && npx playwright install chromium webkit

RUN mkdir -p /app/backend/screenshots /app/backend/traces

EXPOSE 3000

# Pin the container to UTC so an unset Schedule.timezone fires deterministically in UTC.
ENV TZ=UTC

# TypeScript output lives under dist/src because the backend tsconfig compiles from src/.
CMD sh -c "cd backend && npx prisma migrate deploy && npx prisma db seed && node dist/src/index.js"
