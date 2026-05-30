# Release Process

ProofHound uses release-please to manage the SemVer, `CHANGELOG.md`, and GitHub Release of the root `proofhound` package.

When you need to release a new version, manually trigger `.github/workflows/release-please.yml` in GitHub Actions; it creates or updates the release PR. Commit messages follow Conventional Commits: `fix:` produces a patch, `feat:` produces a patch during the `0.x` phase, and `!` or `BREAKING CHANGE` produces a minor during the `0.x` phase.

After the release PR is merged, release-please updates `package.json`, `CHANGELOG.md`, and `.release-please-manifest.json`, and creates the corresponding git tag and GitHub Release.

The current workflow uses the default `GITHUB_TOKEN`. If you later need PRs or Releases created by release-please to trigger other GitHub Actions workflows, configure a dedicated PAT secret for the action.
