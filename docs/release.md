# 发布流程

ProofHound 使用 release-please 管理根 `proofhound` 包的 SemVer、`CHANGELOG.md` 与 GitHub Release。

合并到 `master` 后，`.github/workflows/release-please.yml` 会创建或更新 release PR。提交信息遵循 Conventional Commits：`fix:` 产生 patch，`feat:` 在 `0.x` 阶段产生 patch，`!` 或 `BREAKING CHANGE` 在 `0.x` 阶段产生 minor。

合并 release PR 后，release-please 会更新 `package.json`、`CHANGELOG.md`、`.release-please-manifest.json`，并创建对应的 git tag 与 GitHub Release。

当前工作流使用默认 `GITHUB_TOKEN`。如果后续需要 release-please 创建的 PR 或 Release 触发其它 GitHub Actions workflow，再为 action 配置单独的 PAT secret。
