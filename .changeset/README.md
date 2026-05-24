# Changesets

ProofHound uses Changesets to manage the single product version and generate `CHANGELOG.md`.

Run `pnpm changeset` before a release and select only the root `proofhound` package. The workspace apps and internal packages stay private at `0.0.0`; they are versioned together by the root product release, not independently.

Run `pnpm release` to apply the pending changesets, update the root SemVer version, update `CHANGELOG.md`, and run `pnpm run ci`.
