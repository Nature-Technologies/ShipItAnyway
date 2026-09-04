# ShipItAnyway E2E Workflow Setup

This sample workflow triggers a ShipItAnyway E2E test suite from GitHub Actions and gates pull requests on the resulting commit status.

## Setup Steps

### 1. Create ShipItAnyway API Token

- In your ShipItAnyway instance, create or designate a service-account user for CI integration
- Generate an API token for this user with the `runs_trigger` capability
- Store the token and base URL as repository secrets:
  - **Secret `SIA_TOKEN`:** The API token
  - **Secret `SIA_URL`:** The base URL of your ShipItAnyway instance (e.g., `https://sia.example.com`)

### 2. Set Repository Variables

Configure the target test suite and environment in your repository:
- **Variable `SIA_SUITE_ID`:** The UUID or ID of the ShipItAnyway test suite to run on every commit
- **Variable `SIA_ENV_ID`:** The UUID or ID of the environment (deployment target) to test against

### 3. Enable Commit Status as Branch Protection

After the workflow runs successfully once:
1. Go to **Settings** → **Branches** → **Add rule** (or edit the existing main/default branch protection rule)
2. Under **Require status checks to pass before merging**, enable the status check named `shipitanyway/<suite-slug>`
   - The `<suite-slug>` is derived from your suite's name in ShipItAnyway
   - The workflow sends this as a commit status once the E2E suite completes
3. Save the rule

Once enabled, merges will be blocked until the ShipItAnyway suite passes.

## Making a Repository Depend on Its ShipItAnyway Report

You have two ways to wire a downstream repo to this test-report setup.

### Option A — Copy the standalone workflow

Copy [`shipitanyway.yml`](./shipitanyway.yml) into the target repo's `.github/workflows/`, then complete steps 1–3 above (secrets, variables, branch protection). Nothing else is required — it runs on every push and PR out of the box.

### Option B — Add the trigger step to an existing CI pipeline

If the repo already has a workflow, add the trigger as a step in an existing job. Expose `SIA_URL` as a **job-level** `env` value so the step's `if:` can guard on it — GitHub forbids referencing `secrets.*` directly inside any `if:` condition, so the secret has to travel through `env` first. The step needs `curl` and `jq`, both preinstalled on `ubuntu-latest`.

```yaml
jobs:
  your-existing-job:
    runs-on: ubuntu-latest
    env:
      # Job-level env — required so the step `if:` below can read it (secrets
      # can't be used in `if:` directly).
      SIA_URL: ${{ secrets.SIA_URL }}
    steps:
      # ... your existing steps (build, unit tests, etc.) ...

      - name: Trigger ShipItAnyway E2E suite
        if: ${{ env.SIA_URL != '' }}
        env:
          SIA_TOKEN: ${{ secrets.SIA_TOKEN }}
          SIA_SUITE_ID: ${{ vars.SIA_SUITE_ID }}
          SIA_ENV_ID: ${{ vars.SIA_ENV_ID }}
          GH_REPO: ${{ github.repository }}
          GH_REF: ${{ github.ref }}
          GH_SHA: ${{ github.event.pull_request.head.sha || github.sha }}
          GH_PR: ${{ github.event.number || 0 }}
          GH_RUN_ID: ${{ github.run_id }}
          GH_RUN_ATTEMPT: ${{ github.run_attempt }}
          GH_SERVER: ${{ github.server_url }}
        run: |
          set -euo pipefail
          CORR="${GH_RUN_ID}-${GH_RUN_ATTEMPT}"
          RUN_URL="${GH_SERVER}/${GH_REPO}/actions/runs/${GH_RUN_ID}"
          BODY=$(jq -n \
            --arg suiteId "$SIA_SUITE_ID" \
            --arg envId "$SIA_ENV_ID" \
            --arg repo "$GH_REPO" \
            --arg sha "$GH_SHA" \
            --arg ref "$GH_REF" \
            --argjson pr "${GH_PR:-0}" \
            --arg corr "$CORR" \
            --arg runUrl "$RUN_URL" \
            '{suiteId:$suiteId, environmentId:$envId, ci:{repo:$repo, sha:$sha, ref:$ref, prNumber:$pr, correlationId:$corr, runUrl:$runUrl}}')
          curl -fsS -X POST "$SIA_URL/ci/trigger" \
            -H "Authorization: Bearer $SIA_TOKEN" \
            -H "Content-Type: application/json" \
            -d "$BODY"
```

Requirements for the host job:
- The workflow must trigger `on: pull_request` (and optionally `push`) so the PR head SHA resolves — `github.event.pull_request.head.sha` is what the commit status gets posted against.
- Keep `SIA_URL` at **job** `env` scope as shown. Referencing `secrets.SIA_URL` in an `if:` — at step or job level — is a syntax error in Actions.
- The trigger only *starts* the suite. The CI step succeeds as soon as the trigger is accepted; the actual pass/fail gate arrives later as the commit status (see below).

### Making the merge depend on the result

The trigger step returning `200` does **not** mean the tests passed — it only means the run was queued. To actually gate merges on the E2E outcome, you must enable the `shipitanyway/<suite-slug>` commit status as a required check (step 3 above). That status is what blocks the PR until the suite finishes and reports green.

## How It Works

The workflow:
- Triggers on every push and pull request
- Extracts the commit SHA (for PRs: `pull_request.head.sha`; for pushes: `github.sha`)
- Sends a trigger request to ShipItAnyway with:
  - Repository name and commit SHA
  - Pull request number (if applicable)
  - A unique correlation ID linking the GitHub run to ShipItAnyway
  - A link back to the GitHub Actions run for debugging
- ShipItAnyway asynchronously runs the E2E suite and posts a commit status on GitHub

## Notes

- The workflow will be skipped if `SIA_URL` or `SIA_TOKEN` are not configured (keeping this sample repo's CI clean)
- Each run generates a unique `correlationId` (`github.run_id-github.run_attempt`) for tracing
- PR status checks use the PR head SHA for accuracy, ensuring that stale runs don't gate modern PRs
