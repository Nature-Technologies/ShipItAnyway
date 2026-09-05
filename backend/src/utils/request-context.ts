import { AsyncLocalStorage } from 'node:async_hooks';
import type { Scope } from '@prisma/client';

// Per-request restriction for scoped API tokens. The auth preHandler stashes the token's scopes on
// `req.tokenScopes`; getAuthUser() then binds them into the handler's async context via enterWith
// (calling enterWith in the hook itself does NOT propagate into fastify's handler context). The RBAC
// resolver reads getTokenScopes() and caps authority to user-scopes ∩ token-scopes.
declare module 'fastify' {
  interface FastifyRequest {
    tokenScopes?: Set<Scope>;
  }
}

type RequestStore = { tokenScopes?: Set<Scope> };

const requestContext = new AsyncLocalStorage<RequestStore>();

export function setTokenScopes(scopes: Set<Scope>): void {
  requestContext.enterWith({ tokenScopes: scopes });
}

export function getTokenScopes(): Set<Scope> | undefined {
  return requestContext.getStore()?.tokenScopes;
}
