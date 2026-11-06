# Evidence-bound applicability prototype

This offline module is separate from default DSH selection, Store/SQLite and all existing experience/grants. It has no model API or private-profile input. [ADR051](../../docs/decisions/051-evidence-bound-applicability.md) preregisters the new corpus, fixed methods and limitations; [T057](../../docs/tasks/T057-applicability-gate.md) records acceptance.

## What the boundary establishes

An experience carries a bounded contract, for example:

```json
{"schemaVersion":1,"requires":[{"field":"mode","oneOf":["read"]}],"excludes":[{"field":"disabled","oneOf":[true]}]}
```

The explicit task source contains `{"schemaVersion":1,"facts":{"mode":"read","disabled":false}}`. The caller supplies namespace/task/revision/path/SHA256 references; a trusted read-only port returns the source identity and bytes. The module verifies those bindings, UTF-8, JSON grammar/duplicate keys, <=8192 bytes and <=24 bounded scalar facts before assessing conditions. Up to4 sources,8 required and4 excluded fields; no scripts/expressions or free-form tool-output ingestion. Same-value observations retain both references; conflicting observations remain unknown. Integrity failure invalidates the whole supplied bundle rather than reusing partial/old facts. Reads are fresh per request; no cross-request fact cache.

This verifies values from the **supplied task contract**, not its truth about running code. The caller/port is a trust boundary. There is no natural-language fact extractor, automatic condition authoring, signature-based authenticity or promotion of model assertions to verified facts in this prototype. It cannot replace existing repository/dependency/code/source qualification. Public evaluation facts and conditions are author-written extra information.

| State | Meaning |
|---|---|
| `applicable` | All required conditions confirmed and all exclusions confirmed false. |
| `not_applicable` | At least one known fact contradicts a prerequisite or triggers an exclusion. |
| `insufficient_information` | Missing/invalid condition contract, missing/conflicting facts, unavailable/stale/bad source, or insufficient final retrieval confidence. |

The pure decision helpers describe their inspected candidates, not every possible experience. `contracts_only` allows a unique confirmed match even when other candidates are unknown; it does not establish they are false. The dense-top3 gate blocks a higher-ranked unknown, skips known contradictions, retains the original next-ranked competitor for margin calculation, and never searches rank4 for a replacement. Empty banks/zero scores are ordinary rejection paths. Dense-only's `applicable` state means only its original score gate passed, not that conditions were checked.

## Recompute fixed scoring without ML dependencies

```powershell
npm ci --ignore-scripts
npm run retrieval:applicability -- development
npm run retrieval:applicability -- holdout
```

The CLI accepts only fixed public synthetic inputs and requires a clean working tree matching `method.json` source/data/model/policy digests. It writes JSON to ignored `.probe-work/t057`. No Key/Store/profile is read; vectors are public synthetic artifacts. CI replays scores/conditions/decisions, not neural inference. Neither the old T056 scores nor this corpus may be retuned and relabeled as fresh holdout data after use.

For original method registration, `npm run retrieval:applicability -- freeze` writes a proposed method manifest under ignored `.probe-work/t057`; it does not overwrite the public one. There is no calibration grid or learned rule in T057: dense score0.5/margin0.025 is transferred unchanged from T056, topK3 is preregistered. Three arms separate dense-only, unique-confirmed contracts-only, and dense-top3+contracts. Contracts-only receives additional structured facts that dense-only intentionally does not; this is an information ablation, not a claim of improved semantic understanding.

## Optional local inference

Reuse the exact [T056 model and Windows Python3.10 wheel lock](../retrieval-embedding/README.md), with optional packages at `.probe-work/t056-python-packages` and verified model files at `.probe-work/t056-model`. No old frozen file is modified. Preparation downloads only public model artifacts; export itself reads local verified assets and this fixed synthetic corpus.

```powershell
python scripts/retrieval-embedding.py prepare
python scripts/applicability-embedding.py development
```

Freeze method/development artifacts and results before the first `python scripts/applicability-embedding.py holdout`. Each split has56 vector entries but52 unique text inputs; identical texts share exactly the same inferred vector to control the single-fact pair experiment. Each export uses7 local batch forwards. Precision/pooling/model/dimension/source digests are bound as in T056. Quantized inference can vary slightly by platform; fixed public vectors are the exact deterministic scoring-replay input. Local neural work and zero paid API calls are distinct facts.

The new holdout uses SQL joins, tensor axes, bit flags and inert HTML attribute/text contexts. Development includes known retry/file/null domains. Six query kinds per family are positive, including relevant requests missing a verified fact; six are negative, including irrelevant UI requests with otherwise matching facts. Evidence-conflict/stale probes are reported separately. Same-text counterfactuals differ in a supplied fact by design, so dense-only cannot distinguish them. Complete mistakes, misses and coverage/retention costs must remain visible. No external human labels, natural-language extraction, downstream task benefit or default DSH rollout are established.
