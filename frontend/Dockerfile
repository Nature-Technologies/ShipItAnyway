FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/package.json ./frontend/package.json

RUN corepack enable && pnpm install --frozen-lockfile --filter frontend

COPY frontend/ ./frontend/

ARG VITE_BACKEND_URL=http://localhost:3000
ARG VITE_NOVNC_URL=http://localhost:6080

ENV VITE_BACKEND_URL=$VITE_BACKEND_URL
ENV VITE_NOVNC_URL=$VITE_NOVNC_URL

# ── dev target: Vite dev server with HMR. Source is bind-mounted at runtime
# (see docker-compose.debug.yml); vite polls for host file changes. ─────────────────
FROM builder AS dev
ENV VITE_USE_POLLING=true
WORKDIR /app/frontend
EXPOSE 5173
CMD ["npx", "vite", "--host", "0.0.0.0"]

# ── prod build stage (default: last stage) ──────────────────────────────────────────
FROM builder AS build
RUN cd frontend && npx vite build

FROM nginx:alpine AS prod

COPY frontend/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/frontend/dist /usr/share/nginx/html

EXPOSE 80
