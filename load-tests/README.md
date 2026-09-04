# Load tests (k6)

`parallel-runs.js` — fires many test-run triggers in parallel and reads runs under load.

## Run

```bash
k6 run -e EMAIL=you@example.com -e PASSWORD=... load-tests/parallel-runs.js
```

`EMAIL` and `PASSWORD` are **required** (no defaults — never commit credentials).
Backend must be up (`http://localhost:3000`) with that user and at least one project + test.
Setup auto-discovers a project/test/environment; override with env vars if needed.

## Env vars

| Var             | Default                     | Meaning                                    |
|-----------------|-----------------------------|--------------------------------------------|
| `EMAIL`         | **required**                | Login email                                |
| `PASSWORD`      | **required**                | Login password                             |
| `BASE_URL`      | `http://localhost:3000`     | Backend origin                             |
| `MAX_RPS`       | `30`                        | Peak trigger arrival rate (req/s)          |
| `DURATION`      | `1m`                        | Sustain time at peak                       |
| `READ_VUS`      | `10`                        | Concurrent pollers                         |
| `PROJECT_ID` / `TEST_ID` / `ENV_ID` | auto        | Skip discovery, pin targets                |

## The two limits that shape every result

1. **Global rate limit: 100 req/min per IP** (`@fastify/rate-limit`, `backend/src/index.ts`).
   Past ~1.6 req/s the API returns **429**. The script counts these as `rate_limited`, **not**
   failures — hitting the ceiling is correct app behavior. `trigger_errors` only rises on real
   faults (5xx, network, unexpected status).
2. **Worker concurrency: 3** (`TEST_WORKER_CONCURRENCY`, `batch-sequencer.ts`). Enqueued runs
   drain 3-at-a-time through BullMQ no matter how many you push — so queue depth grows under load
   and browser throughput is capped regardless of RPS.

## To actually stress throughput (not the rate limiter)

Raise both, restart backend, then push `MAX_RPS` up:

```bash
# backend env
TEST_WORKER_CONCURRENCY=20        # more parallel browser runs
# and temporarily lift the rate limit in backend/src/index.ts (max: 100 -> higher, or gate by NODE_ENV)

k6 run -e MAX_RPS=200 -e DURATION=3m load-tests/parallel-runs.js
```

Each browser run needs real CPU/RAM (Playwright Chromium). Watch host resources; concurrency
of 20 on a laptop will thrash. This is the real ceiling once the rate limit is out of the way.

## Metrics to read

- `runs_enqueued` — total 202s (runs accepted onto the queue).
- `rate_limited` — share of triggers bounced by the 100/min limit.
- `trigger_latency` / `read_latency` — p95 of accepted enqueue and read calls.
- `trigger_errors` / `read_errors` — real failures; thresholds fail the run if >1%.
