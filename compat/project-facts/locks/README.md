# T059 original dependency graphs

These are byte-for-byte copies from commit `8533377e28a35f0d9cb0fd1adc0443d095124c44`, before T064 added the official DeepSeek SDK development dependency. Their SHA256 values are the original `compat/project-facts/method.json` values:

- rc.2: `5e1e10c6a19c6303b824ed585a57544564287dbc50256646f554c50bcf0dd881`
- rc.5: `5455d18730395656270ab02cf4df54b0615ad74729cc9dd034ea53d631c690fe`

They preserve the original experiment's metadata; they are not today's active graph. The strict original evaluator remains unchanged and requires its original graph. `scripts/project-facts-current-replay.ts` instead verifies these historical bytes, checks every existing package's code/dependency metadata in the extended graph, and compares all saved vector-based results. That is a current-graph regression, not another execution of the original ML or holdout experiment. Do not overwrite the original method, vectors or results to match a new lock.
