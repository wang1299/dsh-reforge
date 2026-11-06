# Bounded project facts and explicit goals

[ADR053](../../docs/decisions/053-project-schema-facts-and-goals.md) preregisters the supported draft-07 subset, source/goal trust boundaries and five-arm comparison. [Runnable local preview](../../examples/project-facts/README.md) reads a real file and explains confirmed/unknown facts without a user profile, model or ledger. It is source-only and separate from normal DSH selection.

## Recompute fixed public results

After the method, vectors and first results have been committed:

```powershell
npm ci --ignore-scripts
npm run retrieval:project-facts -- development
npm run retrieval:project-facts -- holdout
```

The command requires a clean checkout and exact source/data/model/policy/dependency-lock digests. It materializes only frozen public synthetic schemas in a new ignored directory and uses the real bounded filesystem adapter. It never reads a private profile, grants or financial state. JSON output stays under `.probe-work/t059`; existing reports and methods are not overwritten.

The five arms share original dense ranks, score0.5, original-next margin0.025 and top3. `dense_only` gets text; `manual_facts` gets additional independently checked authored facts; `auto_facts` projects the bounded schema subset; `auto_facts_goal` and `manual_facts_goal` also get an explicit structured goal. All fact arms get the explicit target property and share identity/availability/hash/bounded-JSON integrity gates. Manual reference can interpret valid schemas outside the automatic subset but cannot bypass missing/stale sources. The automatic path never reads reference facts or relevance labels. Identical text shares vectors, including the three-entry controlled groups; fact and goal flips are reported separately.

Full-input support/unknowns and fact agreement **conditioned on successful projection** are separate. Required/null behavior is cross-checked with Ajv8.20; non-null declaration type classification is a distinct source-declaration check. Ajv is a locked dev dependency with defaults/coercion/removal disabled, no custom keywords or remote loading, never a projection/runtime dependency. Schema declarations do not prove application implementation, current source qualification or downstream Agent benefit.

## Original local inference and method registration

Use the exact [T056 public model and optional Windows Python3.10 dependencies](../retrieval-embedding/README.md). No new model is downloaded by the exporter, and no network/model API is used during inference. The new exporter validates local weights/tokenizer/runtime versions and the fixed corpus before local CPU inference:

```powershell
python scripts/project-facts-embedding.py development
```

Commit fixed method/development vectors and publish complete development results before first running `python scripts/project-facts-embedding.py holdout`. Snapshot scoring replay is not independent proof of inference. `npm run retrieval:project-facts -- freeze` creates a proposed manifest in ignored work only; it never overwrites the public method. Source/dependency digests bind projection, assessment, evaluation, exporter, independent oracle and frozen retrieval helpers.

The dataset is96 author-visible queries across8 new schema artifacts,48/24 positive queries per partition; JSON field-presence/null is a previously seen domain. It is artifact-heldout, not a new problem-family blind test or external user study. Missing-goal positives, unsupported-schema positives and integrity probes remain in denominators. All misses, wrong offers, retention losses and gains must be published. None of this promotes the prototype to default DSH or a published package.
