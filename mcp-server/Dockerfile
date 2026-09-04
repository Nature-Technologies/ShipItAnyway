FROM node:22-alpine

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY mcp-server/package.json ./mcp-server/package.json

RUN corepack enable && pnpm install --frozen-lockfile --filter mcp-server

COPY mcp-server/src ./mcp-server/src

# Run from the package dir so Node resolves `tsx` (and the app's deps) from
# /app/mcp-server/node_modules — pnpm's workspace install puts them there, not
# in /app/node_modules, so importing tsx/esm from /app fails with ERR_MODULE_NOT_FOUND.
WORKDIR /app/mcp-server

EXPOSE 3100
# HTTP Streamable transport; agents connect over http://<host>:3100/mcp
CMD ["node", "--import", "tsx/esm", "src/index.ts"]
