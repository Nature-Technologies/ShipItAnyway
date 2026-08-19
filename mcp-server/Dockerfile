FROM node:22-alpine

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY mcp-server/package.json ./mcp-server/package.json

RUN corepack enable && pnpm install --frozen-lockfile --filter mcp-server

COPY mcp-server/src ./mcp-server/src

# stdio-only transport: agent CLI spawns this container with `docker run -i`.
# For local dev without compose, run: npx tsx mcp-server/src/index.ts
CMD ["node", "--import", "tsx/esm", "mcp-server/src/index.ts"]
