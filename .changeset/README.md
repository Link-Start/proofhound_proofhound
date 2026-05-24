# Changesets

ProofHound uses Changesets to manage the single product version and generate `CHANGELOG.md`.

Run `pnpm changeset` before a release and select only the root `proofhound` package. The workspace apps and internal packages stay private at `0.0.0`; they are versioned together by the root product release, not independently.

Run `pnpm release` to apply the pending changesets, update the root SemVer version, update `CHANGELOG.md`, run `pnpm run ci`, commit the release artifacts as `chore(release): vX.Y.Z`, and create the annotated git tag `vX.Y.Z`.

The release commit is intentionally limited to `package.json` and `CHANGELOG.md`. Commit feature work before releasing, or keep it unstaged; the release commit step refuses to run when unrelated files are already staged.
