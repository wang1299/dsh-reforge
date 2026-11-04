# Customer form: keep input when saving fails

[中文](README.md) · [Documentation](../../docs/index.en.md) · [Matching video](../../docs/demos/first-task.en.md)

Run the complete synthetic case from the video with real Python, Git, independent pytest checks and Reforge service APIs. The patch is supplied in advance. No DSH installation, API key or model call is required. The example UI is in Chinese.

With Node ≥24.10, Git and Python ≥3.10, run from the source repository root:

```sh
python -m pip install pytest==9.1.1
npm ci --ignore-scripts
npm run example:customer-form
```

On Windows, `py -3.10 -m pip install pytest==9.1.1` selects Python 3.10. For a specific interpreter:

```sh
npm run example:customer-form -- --python /absolute/path/to/python
```

Open the printed customer-form URL. Keep the terminal running; Ctrl+C stops both pages. The separate experience-panel URL contains a private local token: do not share it.

1. Enter synthetic name, phone and notes. Leave failure injection enabled and save: the original bug clears the draft too early.
2. Open the second tab, record the explicit correction, then apply the supplied patch. Only this new synthetic Git project is changed and committed.
3. Refill the form: a failed save must preserve every field. Disable failure injection and save again: success clears the draft. The button prevents repeated submission while saving.
4. Run verification. The same two external checks must fail on the original revision and pass on the fixed revision; all three in-project regression checks must pass.
5. Open the private experience panel: expect one source-verified experience, zero applications, zero feedback and zero model calls.

Each launch creates a unique ignored `.probe-work/customer-form-*` directory: `project/`, external `acceptance/`, private local `config.json`, `data/` and a bounded `result.json`. Existing projects, experiences, grants and budgets are not used. `before/` and `after/` publish both versions; `project/` and `acceptance/` publish the exact tests. [The runner](../../scripts/customer-form.ts) uses real service methods, not direct database inserts.

A failed or interrupted verification retains the run and cannot be blindly retried. A new launch creates a separate fresh case. After stopping, inspect the retained data with `node dist/src/cli.js panel --config <run-config.json>`; this opens a panel without replaying the workflow. Cleanup is manual after checking the exact synthetic directory and stopping its processes.

If Python or pytest is missing, install into the selected interpreter and pass its path. If the page refuses connections, keep the runner alive and use its newly printed address. Share only versions, the failed step and redacted counts when reporting a problem; never upload a database, token, full configuration or raw log.

This verifies the source repair. It does not demonstrate autonomous coding, automatic extraction or future-task benefit. Continue with [first configuration and verification](../../docs/getting-started/quickstart.en.md), [FAQ](../../docs/faq.md) and the separately authorized [automatic-learning setup](../../docs/installation.md#3-开启正常对话自动学习).
