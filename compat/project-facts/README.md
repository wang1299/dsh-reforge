# Bounded project facts and explicit goals

[ADR053](../../docs/decisions/053-project-schema-facts-and-goals.md) preregisters the supported draft-07 subset, source/goal trust boundaries and five-arm comparison. [Runnable local preview](../../examples/project-facts/README.md) reads a real file and explains confirmed/unknown facts without a user profile, model or ledger. It is source-only and separate from normal DSH selection.

## Current checkout: regress the extended dependency graph

T064 added the official SDK as a development dependency. Today's locks are therefore different from the original T059 graph. Run the separate current-graph regression:

```powershell
npm ci --ignore-scripts
npm run retrieval:project-facts:regression
```

It validates the [archived original lock bytes](locks/README.md) against the immutable method, checks all existing package code/dependency metadata in the current graph, validates schema labels independently, and reproduces both partitions' complete vector-based results. Each run materializes only public synthetic schemas in a new `.probe-work/t059-current-graph-replay` directory. It does not read private profiles/grants/ledgers or overwrite original methods/results. Its output is labeled `current-extended-graph-regression`; it is not the original ML or first holdout experiment executed again.

## Historical exact-graph replay

Use a separate clean historical checkout at `8533377e28a35f0d9cb0fd1adc0443d095124c44`, with its original package manifest and locks. Do not replace today's locks or run against a directory holding previous private study outputs. In that historical checkout:

```powershell
npm ci --ignore-scripts
npx tsc
node dist/scripts/project-facts-evaluate.js development
node dist/scripts/project-facts-evaluate.js holdout
```

The unchanged strict evaluator requires exact source/data/model/policy/dependency-lock digests and refuses the extended graph. Its output is under that historical checkout's `.probe-work/t059`; use a new isolated checkout so old outputs remain intact. Archived locks alone do not turn the current manifest into the original environment.

The five arms share original dense ranks, score0.5, original-next margin0.025 and top3. `dense_only` gets text; `manual_facts` gets additional independently checked authored facts; `auto_facts` projects the bounded schema subset; `auto_facts_goal` and `manual_facts_goal` also get an explicit structured goal. All fact arms get the explicit target property and share identity/availability/hash/bounded-JSON integrity gates. Manual reference can interpret valid schemas outside the automatic subset but cannot bypass missing/stale sources. The automatic path never reads reference facts or relevance labels. Identical text shares vectors, including the three-entry controlled groups; fact and goal flips are reported separately.

Full-input support/unknowns and fact agreement **conditioned on successful projection** are separate. Required/null behavior is cross-checked with Ajv8.20; non-null declaration type classification is a distinct source-declaration check. Ajv is a locked dev dependency with defaults/coercion/removal disabled, no custom keywords or remote loading, never a projection/runtime dependency. Schema declarations do not prove application implementation, current source qualification or downstream Agent benefit.

## Original local inference and method registration

Use the exact [T056 public model and optional Windows Python3.10 dependencies](../retrieval-embedding/README.md). No new model is downloaded by the exporter, and no network/model API is used during inference. The new exporter validates local weights/tokenizer/runtime versions and the fixed corpus before local CPU inference:

```powershell
python scripts/project-facts-embedding.py development
```

These are historical protocol steps in the original graph: commit fixed method/development vectors and publish complete development results before first running `python scripts/project-facts-embedding.py holdout`. Snapshot scoring replay is not independent proof of inference. `node dist/scripts/project-facts-evaluate.js freeze` creates a proposed manifest in ignored work only; it never overwrites the public method. Source/dependency digests bind projection, assessment, evaluation, exporter, independent oracle and frozen retrieval helpers. The current-graph regression does not rerun or relabel those historical steps.

The dataset is96 author-visible queries across8 new schema artifacts,48/24 positive queries per partition; JSON field-presence/null is a previously seen domain. It is artifact-heldout, not a new problem-family blind test or external user study. Missing-goal positives, unsupported-schema positives and integrity probes remain in denominators. All misses, wrong offers, retention losses and gains must be published. None of this promotes the prototype to default DSH or a published package.
