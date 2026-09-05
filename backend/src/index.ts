import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import fastifyHelmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import { config as loadEnv } from 'dotenv';
import dotenvExpand from 'dotenv-expand';
import fs from 'node:fs';
import path from 'node:path';
import prisma from './prisma';
import { authRoutes } from './routes/auth';
import { startTestWorker, stopTestWorker } from './queue/worker';
import { testQueue } from './queue/queue';
import { startScheduleWorker, stopScheduleWorker, scheduleQueue } from './queue/schedule-queue';
import { startReportWorker, stopReportWorker, reportQueue } from './queue/report-queue';
import { startCiDeliveryWorker, stopCiDeliveryWorker, ciDeliveryQueue } from './queue/ci-delivery-queue';
import { reportScheduler } from './services/report-scheduler';
import redis from './redis';
import { dashboardRoutes } from './routes/dashboard';
import { channelRoutes } from './routes/channels';
import { exportRoutes } from './routes/export';
import { recordingRoutes } from './routes/recordings';
import { environmentRoutes } from './routes/environments';
import { scheduleRoutes } from './routes/schedules';
import { suiteRoutes } from './routes/suites';
import { runRoutes } from './routes/runs';
import { projectRoutes } from './routes/projects';
import { webhookRoutes } from './routes/webhooks';
import { testRoutes } from './routes/tests';
import { schedulerService } from './services/scheduler';
import { resolveApiToken } from './utils/api-token';
import { verifyArtifactSig } from './utils/signed-url';
import { fixtureRoutes } from './routes/fixtures';
import { groupRoutes } from './routes/groups';
import { userRoutes } from './routes/users';
import { teamRoutes } from './routes/teams';
import { inviteRoutes } from './routes/invites';
import { reportRoutes } from './routes/reports';
import { apiTokenRoutes } from './routes/api-tokens';
import { ciRoutes } from './routes/ci';
import { mcpRoutes } from './routes/mcp';

const envCandidates = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '..', '.env')
];
const screenshotsDir = path.resolve(process.env.SCREENSHOTS_DIR || './screenshots');
const tracesDir = path.resolve(process.env.TRACES_DIR || './traces');
const fixturesDir = path.resolve(process.env.FIXTURES_DIR || './fixtures');
const defaultFrontendOrigins = [
  'http://localhost:5173',
  'http://localhost:80',
  'http://127.0.0.1:5173'
];

function collectFrontendOrigins() {
  const origins = new Set<string>(defaultFrontendOrigins);

  for (const candidate of [process.env.FRONTEND_URL, process.env.FRONTEND_DEV_URL]) {
    if (!candidate) continue;

    try {
      origins.add(new URL(candidate).origin);
    } catch {
      // Ignore invalid URLs and keep the safe defaults.
    }
  }

  return [...origins];
}

const traceViewerRoot = path.join(
  path.dirname(require.resolve('playwright-core/package.json')),
  'lib/vite/traceViewer'
);

for (const envPath of envCandidates) {
  if (fs.existsSync(envPath)) {
    const loaded = loadEnv({ path: envPath });
    dotenvExpand.expand(loaded);
    break;
  }
}

fs.mkdirSync(screenshotsDir, { recursive: true });
fs.mkdirSync(tracesDir, { recursive: true });
fs.mkdirSync(fixturesDir, { recursive: true });

// Rate limiting keys on req.ip. Behind a reverse proxy, req.ip is the proxy unless trustProxy is
// set — but trusting X-Forwarded-* blindly lets clients spoof it. So default OFF and let the deploy
// opt in with the exact hop count / trusted CIDR via TRUST_PROXY (e.g. "1", "true", "10.0.0.0/8").
function parseTrustProxy(): boolean | number | string {
  const v = process.env.TRUST_PROXY;
  if (!v) return false;
  if (v === 'true') return true;
  if (v === 'false') return false;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : v;
}

async function start() {
  // `as` cast: Fastify accepts a numeric hop count for trustProxy at runtime (proxy-addr), but its
  // type omits `number`; the cast keeps hop-count support without loosening anything else.
  const serverOptions = { logger: true, trustProxy: parseTrustProxy() } as import('fastify').FastifyServerOptions;
  const fastify = Fastify(serverOptions);
  const port = Number(process.env.BACKEND_PORT) || 3000;
  const frontendOrigins = [
    process.env.FRONTEND_URL || 'http://localhost:5173',
    process.env.FRONTEND_DEV_URL || 'http://localhost:5173',
    // The compose-internal frontend origin, so a browser loading the app by service
    // name (e.g. the in-container recorder dogfooding SIA's own UI) isn't CORS-blocked.
    process.env.FRONTEND_INTERNAL_URL,
    'http://127.0.0.1:5173'
  ].filter((o): o is string => Boolean(o));

  await fastify.register(cors, {
    origin: frontendOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
  });

  // Deny framing globally (the JSON API must never be embedded → clickjacking). The trace-viewer
  // routes below remove X-Frame-Options and set a scoped frame-ancestors CSP instead, since the
  // frontend legitimately iframes them. CSP stays off globally (JSON API; viewer sets its own).
  await fastify.register(fastifyHelmet, {
    contentSecurityPolicy: false,
    frameguard: { action: 'deny' }
  });

  await fastify.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute'
  });

  // Fail closed: a missing/weak JWT secret lets anyone forge tokens for any user (incl. superadmin).
  // No fallback constant — refuse to boot without a strong secret.
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret || jwtSecret.length < 32 || jwtSecret.includes('replace-this')) {
    throw new Error('JWT_SECRET must be set to a strong random value of at least 32 characters (not the placeholder)');
  }

  await fastify.register(fastifyJwt, {
    secret: jwtSecret
  });

  // Run artifacts (traces + screenshots) are gated by short-lived signed URLs minted by the authed
  // /runs/:id handler — NOT blanket-public — because they can contain secrets. The trace-viewer app
  // itself stays public (it holds no secrets; the trace zip it loads is signed).
  const artifactPrefixes = ['/screenshots/', '/traces/', '/api/traces/'];

  fastify.addHook('preHandler', async (req, reply) => {
    if ((req.method === 'GET' || req.method === 'HEAD') && artifactPrefixes.some((p) => req.url.startsWith(p))) {
      const pathname = req.url.split('?')[0];
      const q = req.query as { exp?: string; sig?: string };
      if (verifyArtifactSig(pathname, q.exp, q.sig)) return;
      return reply.status(401).send({ error: 'Invalid or expired artifact URL' });
    }

    const publicRoutes = [
      { method: 'POST', url: '/auth/login' },
      { method: 'POST', url: '/auth/logout' },
      { method: 'GET', url: '/auth/invite' },
      { method: 'POST', url: '/auth/accept-invite' },
      { method: 'GET', url: '/health' },
      { method: 'GET', url: '/health/db' },
      { method: 'POST', url: '/webhooks/trigger' },
      { method: 'GET', url: '/trace-viewer/' },
      { method: 'GET', url: '/api/trace-viewer/' },
      { method: 'GET', url: '/trace-viewer' }
    ];

    const isPublic = publicRoutes.some((route) =>
      req.url.startsWith(route.url) &&
      (route.method === req.method || (req.method === 'HEAD' && route.method === 'GET'))
    );

    if (isPublic) return;

    try {
      const viaToken = await resolveApiToken(req.headers.authorization);
      if (viaToken) {
        req.user = viaToken;
        return;
      }
      await req.jwtVerify();
      const payload = req.user as { userId?: string; email?: string } | undefined;
      if (!payload?.userId || !payload.email) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: { email: true }
      });

      if (!user || user.email !== payload.email) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
    } catch {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  await fastify.register(authRoutes);

  await fastify.register(fastifyStatic, {
    root: screenshotsDir,
    prefix: '/screenshots/',
    decorateReply: false,
    setHeaders: (reply) => {
      reply.header('Cross-Origin-Resource-Policy', 'cross-origin');
    }
  });

  await fastify.register(fastifyStatic, {
    root: tracesDir,
    prefix: '/traces/',
    decorateReply: false,
    setHeaders: (reply) => {
      reply.header('Access-Control-Allow-Origin', 'https://trace.playwright.dev');
      reply.header('Cross-Origin-Resource-Policy', 'cross-origin');
    }
  });

  await fastify.register(fastifyStatic, {
    root: tracesDir,
    prefix: '/api/traces/',
    decorateReply: false,
    setHeaders: (reply) => {
      reply.header('Access-Control-Allow-Origin', 'https://trace.playwright.dev');
      reply.header('Cross-Origin-Resource-Policy', 'cross-origin');
    }
  });

  await fastify.register(fastifyStatic, {
    root: traceViewerRoot,
    prefix: '/trace-viewer/',
    decorateReply: false,
    setHeaders: (reply) => {
      // Let the frontend iframe the viewer: drop the global X-Frame-Options: DENY and scope framing
      // to trusted origins via CSP frame-ancestors instead.
      reply.removeHeader('X-Frame-Options');
      const frameAncestors = ["'self'", ...collectFrontendOrigins()].join(' ');
      reply.header('Content-Security-Policy', `frame-ancestors ${frameAncestors}`);
    }
  });

  await fastify.register(fastifyStatic, {
    root: traceViewerRoot,
    prefix: '/api/trace-viewer/',
    decorateReply: false,
    setHeaders: (reply) => {
      // Let the frontend iframe the viewer: drop the global X-Frame-Options: DENY and scope framing
      // to trusted origins via CSP frame-ancestors instead.
      reply.removeHeader('X-Frame-Options');
      const frameAncestors = ["'self'", ...collectFrontendOrigins()].join(' ');
      reply.header('Content-Security-Policy', `frame-ancestors ${frameAncestors}`);
    }
  });

  await fastify.register(import('@fastify/multipart'), { limits: { fileSize: 50 * 1024 * 1024 } });

  await fastify.register(projectRoutes);
  await fastify.register(environmentRoutes);
  await fastify.register(channelRoutes);
  await fastify.register(exportRoutes);
  await fastify.register(dashboardRoutes);
  await fastify.register(suiteRoutes);
  await fastify.register(scheduleRoutes);
  await fastify.register(testRoutes);
  await fastify.register(runRoutes);
  await fastify.register(webhookRoutes);
  await fastify.register(recordingRoutes);
  await fastify.register(fixtureRoutes);
  await fastify.register(groupRoutes);
  await fastify.register(userRoutes);
  await fastify.register(teamRoutes);
  await fastify.register(inviteRoutes);
  await fastify.register(reportRoutes);
  await fastify.register(apiTokenRoutes);
  await fastify.register(ciRoutes);
  await fastify.register(mcpRoutes);
  await startTestWorker();
  startScheduleWorker();
  await schedulerService.loadAll();
  startReportWorker();
  await reportScheduler.loadAll();
  startCiDeliveryWorker();

  // ponytail: in-process interval (matches single-instance assumption); move to BullMQ repeatable if backend is ever scaled
  const ciReconcileTimer = setInterval(() => {
    import('./services/ci-reconcile')
      .then((m) => m.reconcileStuckCiRuns())
      .catch((e) => console.error('[CI reconcile] failed:', e));
  }, 5 * 60 * 1000);
  ciReconcileTimer.unref();

  // Generic error handler: log the real error server-side, but never echo internal messages/stack
  // to clients on 5xx (default Fastify behavior leaks err.message, e.g. raw DB errors).
  fastify.setErrorHandler((error: import('fastify').FastifyError, req, reply) => {
    const status = error.statusCode ?? 500;
    if (status >= 500) {
      req.log.error(error);
      return reply.status(status).send({ error: 'Internal Server Error' });
    }
    // Preserve intentional 4xx validation/auth messages.
    return reply.status(status).send({ error: error.message });
  });

  fastify.get('/health', async () => ({ status: 'ok', port }));

  fastify.get('/health/db', async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', db: 'connected' };
  });

  fastify.get('/trace-viewer', async (_, reply) => {
    return reply.redirect('/trace-viewer/', 302);
  });

  fastify.get('/api/trace-viewer', async (_, reply) => {
    return reply.redirect('/api/trace-viewer/', 302);
  });

  await fastify.listen({ port, host: '0.0.0.0' });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    fastify.log.info(`Received ${signal}, shutting down gracefully`);

    // ponytail: hard-exit ceiling if a close() hangs, so we never re-hang the terminal
    const forceExit = setTimeout(() => {
      fastify.log.error('Graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, 10_000);
    forceExit.unref();

    try {
      schedulerService.stopAll();
      await fastify.close();
      await stopTestWorker();
      await testQueue.close();
      await stopScheduleWorker();
      await scheduleQueue.close();
      await stopReportWorker();
      await reportQueue.close();
      await stopCiDeliveryWorker();
      await ciDeliveryQueue.close();
      await redis.quit();
      process.exit(0);
    } catch (error) {
      fastify.log.error(error, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void start().catch((error) => {
  // Keep startup failures visible and exit non-zero.
  console.error(error);
  process.exit(1);
});
