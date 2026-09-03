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
