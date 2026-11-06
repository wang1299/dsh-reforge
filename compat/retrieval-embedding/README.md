# Optional local multilingual retrieval experiment

This is an **offline synthetic-data prototype**, separate from default DSH selection. It does not open a Store, read private experience, train a model, contact a model API, or change SQLite/budgets/grants. Source verification and downstream task benefit are separate claims. Design and preregistered calibration: [ADR050](../../docs/decisions/050-offline-multilingual-hybrid.md).

## Recompute scoring without a model

Node 24 and the repository's existing npm dependencies suffice. Published vectors contain only the frozen, author-written public synthetic queries/reminders. CI replays cosine, BM25, fusion, calibration and every selection from these vectors; it does not download weights or independently reproduce neural inference.

```powershell
npm ci --ignore-scripts
npm run retrieval:hybrid -- development
npm run retrieval:hybrid -- holdout
```

Results go to `.probe-work/t056/development.json` and `holdout.json`. Holdout requires a clean working tree and source digests matching the frozen calibration. Timing is machine-dependent; quality rows and aggregate metrics are deterministic. Recall@3/MRR describe the complete eligible ranking **before** abstention, including zero-score ID ties; positiveRecall counts correct offers **after** the score/margin gates. Dense timing also includes an unused BM25 pass for diagnostics, so it is not optimized standalone vector latency. The 120-query corpus has already been inspected by its author and will be spent as a holdout after the first evaluation. Do not retune against it and claim a new blind result.

## Independently reproduce local inference (optional Windows Python 3.10)

The original author's [Apache-2.0 multilingual MiniLM model](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2) is pinned to a revision and verified artifact digests in `model.json`. Model downloads total about 128 MB and stay in ignored `.probe-work/t056-model`. The complete Windows/Python 3.10 wheel lock includes resolved transitive dependencies; no ML dependency is added to npm or the plugin runtime.

```powershell
python -m pip install --only-binary=:all: --require-hashes --target .probe-work/t056-python-packages -r compat/retrieval-embedding/requirements-win-py310.lock
python scripts/retrieval-embedding.py prepare
python scripts/retrieval-embedding.py export-development
```

`prepare` is the only model-download action. `export-*` verifies all local artifacts before loading ONNX, accepts only the fixed synthetic corpus, rejects over-128-token inputs, and performs attention-mask mean pooling plus L2 normalization. It records the CPU engine, exact top-level runtime versions, 7-decimal precision, text count, forward passes and elapsed inference time. Quantized outputs can vary slightly across hardware/runtime implementations; published vectors are the exact scoring-replay input, not a promise of byte-identical inference on every CPU. Zero paid HTTP calls does not mean zero local model computation.

For the original experiment, export and calibrate **development only**, then commit method, development vectors and `calibration.json` before `export-holdout`. `npm run retrieval:hybrid -- calibrate` writes a proposed calibration to ignored `.probe-work`; it cannot replace the frozen one automatically. It retains all 24 dense and 72 hybrid grid results. If either arm has no admissible configuration, the artifact records `no_admissible_config` with nullable config; the command exits 2 **after saving both grids** and evaluation must stop before holdout. Do not copy a regenerated calibration over the public experiment or overwrite first-run reports. A later method needs a new task-family holdout.

Vector cache entries bind model-manifest digest (revision/weights/tokenizer/pooling), corpus digest, dimension, namespace, ID, revision and exact text digest. Missing or incompatible vectors fail explicitly. Eligibility exclusions apply before both BM25 IDF and cosine ranking; this synthetic eligibility declaration does not prove actual source validity.
