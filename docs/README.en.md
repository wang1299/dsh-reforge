# DSH-Reforge

<p align="center">
  <img src="https://raw.githubusercontent.com/wang1299/dsh-reforge/main/docs/assets/dsh-reforge-hero-v3.png" alt="DSH-Reforge — Fix. Verify. Reforge." width="1000" />
</p>

<p align="center"><strong>修复有据，经验可循。</strong></p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-reforge/v/0.1.0-alpha.2"><img src="https://img.shields.io/npm/v/dsh-reforge/alpha?label=npm%20alpha" alt="npm alpha" /></a>
  <a href="https://github.com/wang1299/dsh-reforge/blob/main/docs/dsh-version-matrix.md"><img src="https://img.shields.io/badge/DSH-0.2.0--rc.2%20%7C%200.2.1--rc.5-39424e" alt="DSH 0.2.0-rc.2 / 0.2.1-rc.5" /></a>
  <a href="https://github.com/wang1299/dsh-reforge/actions/workflows/check.yml"><img src="https://github.com/wang1299/dsh-reforge/actions/workflows/check.yml/badge.svg?branch=main" alt="CI" /></a>
  <a href="https://github.com/wang1299/dsh-reforge/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT" /></a>
</p>

<p align="center">
  <a href="https://github.com/wang1299/dsh-reforge/blob/main/README.md">中文</a> ·
  <a href="https://github.com/wang1299/dsh-reforge/blob/main/docs/README.en.md">English</a> ·
  <a href="https://github.com/wang1299/dsh-reforge/blob/main/docs/installation.md">Installation (Chinese)</a> ·
  <a href="https://github.com/wang1299/dsh-reforge/blob/main/docs/compatibility.md">Compatibility (Chinese)</a> ·
  <a href="https://github.com/wang1299/dsh-reforge/blob/main/CHANGELOG.md">Changelog (Chinese)</a>
</p>

**DSH-Reforge (`dsh-reforge` on npm) is a community plugin for DeepSeek Harness. It builds traceable experience from test-verified Python bug fixes and selects applicable experience as context for later tasks.**

**This release: `dsh-reforge@0.1.0-alpha.2`, experimental alpha.** It includes the new workbench, runnable example, conservative setup, diagnostics, backup and restore. Check [publication status](release-status.md) and [Issue #113](https://github.com/wang1299/dsh-reforge/issues/113) for actual npm/Release verification. This independent community project is not officially reviewed, endorsed, or security certified by DeepSeek.


Supports exactly DSH `0.2.0-rc.2` and `0.2.1-rc.5`, through an independent adapter and four Windows/Linux combinations; see the [version matrix](dsh-version-matrix.md). Historical alpha.1 supports only the older host. Other DSH versions require separate verification.

## What it does

- **Records bounded evidence:** once the repository owner enables learning, direct user requests create execution segments with short summaries and limited Python code snapshots.
- **Verifies the source repair:** replays the original failure, independent acceptance tests for the fix, and regression tests in temporary workspaces. A completed turn triggers checking; it does not establish correctness.
- **Extracts candidates:** uses an explicitly configured model registered with DSH to extract candidates with source references and applicability conditions, then independently checks their source evidence.
- **Selects relevant experience:** checks repository, code, dependencies, and relevance before supplying a small amount of context. It may provide none when evidence is insufficient or inapplicable.
- **Supports inspection and correction:** the DSH plugin page shows learning progress, experience, sources, history, and usage records, with feedback, revisions, deactivation, and restoration.

Source verification establishes that a repair passed its checks at that time. **It does not prove that the experience improves future tasks.** Earlier small controlled comparisons did not show an improvement in acceptance success rates; see the [evaluation record (Chinese)](development/T008c-acceptance.md).

## Demo: keep user input when saving fails

**Run the same project:** [examples/customer-form](../examples/customer-form/README.en.md) includes original/fixed code, external acceptance and regressions. Run `npm run example:customer-form` without a key or DSH installation. Continue with the [first-use guide](getting-started/quickstart.en.md), [documentation index](index.en.md), [release status](release-status.md), [FAQ](faq.md) and [external pilot](community/pilot.md).

[![DSH-Reforge first-task demo: keep user input when saving fails](https://raw.githubusercontent.com/wang1299/dsh-reforge/main/docs/assets/demos/first-task-poster.jpg)](https://github.com/wang1299/dsh-reforge/raw/refs/heads/main/docs/assets/demos/first-task-demo-1080p.mp4)

[Download demo MP4 (2:02, 1080p)](https://github.com/wang1299/dsh-reforge/raw/refs/heads/main/docs/assets/demos/first-task-demo-1080p.mp4) · [English subtitles](https://github.com/wang1299/dsh-reforge/blob/main/docs/assets/demos/first-task.en.srt) · [Case and acceptance notes](https://github.com/wang1299/dsh-reforge/blob/main/docs/demos/first-task.en.md)

The video follows a customer form that loses input after a failed save: explicit correction, a real patch, independent acceptance, and a stored experience. Both original acceptance checks fail; the fixed version passes 2/2 checks and 3/3 regression tests. The video has Chinese narration and burned-in Chinese captions; English subtitles are provided as a separate file.

**This is a synthetic, local explicit-recording case**, using the alpha.2 standalone workbench. Codex prepared the patch, which the demo page applies. The video has no autonomous coding, automatic extraction or paid calls. A separate [real-model report](evaluation/t049-20261104/README.md) passed the automatic path; both retrieval arms abstained on held-out tasks, so no effect of using memory was measured.

## Install and open

Requires **Node.js ≥24.10 and DSH 0.2.0-rc.2 or 0.2.1-rc.5**. Repair verification also requires Git, Python ≥3.10, and pytest; CI pins pytest 9.1.1. Only those exact hosts are supported. The plugin does not run in the DeepSeek chat website.

Install the exact version in your DSH environment:

```sh
dsh plugin --profile web add dsh-reforge@0.1.0-alpha.2
```

Before starting DSH, set `DSH_REFORGE_CONFIG` to the absolute path of a private JSON configuration file. A minimal read-only configuration is:

```json
{
  "repoRoot": "/absolute/path/to/your/repository"
}
```

For example, in PowerShell:

```powershell
$env:DSH_REFORGE_CONFIG = 'D:\my-local-config\reforge.json'
```

Stop the previous DSH process and start Web with the same profile:

```sh
dsh web --profile web
```

Open the full authentication URL printed by DSH. Do not share that URL. In the left sidebar, open **Plugins → dsh-reforge → plugin detail page**. The experience button at the top of an existing conversation also opens the page. Opening the page does not call a model.

Learning is off by default. To enable it, the owner must configure independent acceptance tests outside the target repository, execution trust, model sharing, and an extraction allowance. See the [installation and migration guide (Chinese)](installation.md). The legacy `DSH_EVOLVE_CONFIG` variable remains supported; when both variables are set, they must resolve to the same file. Configure provider credentials through DSH, never in the plugin JSON file.

## From a repair to an experience

1. The repository owner configures independent acceptance tests, execution trust, model sharing, and extraction calls, then enables learning.
2. Make a normal Python bug-fix request in DSH and give explicit corrections when needed.
3. The plugin checks the original failure, fixed code, and regression tests in temporary workspaces. With the required evidence and authorization, it extracts a candidate and independently checks it.
4. Inspect the experience, scope, and source in the plugin page. A later applicable request may receive it as context; users can give feedback or deactivate it.

This describes the current workflow. Source checks and subsequent usage records do not establish task improvement. Reusable [Chinese and English project introductions](public-introduction.md) are maintained separately.

## Current limits

- The first release focuses on **Python + pytest repairs within one repository**. Each direct request is a separate execution segment; there is no semantic merging across turns. New Python files, symlinks, interleaved requests, version drift, or unsupported changes may prevent learning.
- Automatic learning requires explicit execution trust, model sharing, independent acceptance tests, and an extraction allowance. `maxCalls` limits extraction calls; **it is not a monetary cap for the full DSH session**. Calls with an unknown outcome are not automatically retried or credited back.
- Local verification executes repository code and **does not provide a strong sandbox**. Enable it only for repositories you trust. The plugin does not automatically roll back or commit your code.
- The default data location remains `~/.dsh/evolve/<repoId>/evolve.sqlite`, currently SQLite v9. Renaming preserves old history, `evolve_` tools, and internal identifiers; it does not move experience data or reset grants.
- The plugin does not store full conversations, attachments, or arbitrary tool output. Automatic mode stores bounded summaries, a few explicit corrections, source identifiers, and limited code snapshots. Automatic complete erasure is not currently implemented. When model sharing is enabled, bounded repair material is sent to the selected provider.
- Windows full Web checks, core CI on Windows and Linux, and installation exercises have been run. Scripted models verify execution paths; they do not establish real-model quality, Desktop support, compatibility with other versions, or task improvement.

## Develop from source

```sh
npm ci --ignore-scripts
npm run check
npm run compat
npm run demo
```

The demo uses synthetic cases only. Follow its configuration path and run `node dist/src/cli.js panel --config <config.json>` to open the standalone panel. Its full URL includes a local access token; do not share it. Development and installation checks use isolated profiles.

[Product requirements (Chinese)](product.md) · [Architecture (Chinese)](architecture.md) · [Roadmap (Chinese)](roadmap.md) · [Contributing (Chinese)](../CONTRIBUTING.md) · [Changelog (Chinese)](../CHANGELOG.md)

This repository implements its own data, verification, selection, and update mechanisms. MIT License. [Brand assets and usage notes (Chinese)](branding.md).
