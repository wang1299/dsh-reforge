"""Local CPU vectors for fixed PUBLIC T072 data only. No API, arbitrary text or profile input."""
import argparse
import importlib.metadata
import importlib.util
import json
import math
from pathlib import Path
import sys
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('frozen_embedding_assets', ROOT / 'scripts/retrieval-embedding.py')
ASSETS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ASSETS)
DATA = (ROOT / 'test/fixtures/semantic-memory-v1.json').read_bytes()
DATA_DIGEST = '0868e6bf93014503a7f2cbfbec7ae765d1bc1eabd0923281aed434e3cd3f23df'


def export(partition):
    if ASSETS.sha(DATA) != DATA_DIGEST:
        raise ValueError('Frozen semantic memory corpus changed')
    if partition == 'holdout':
        dirty = subprocess.check_output(['git', '-C', str(ROOT), 'status', '--porcelain'], text=True)
        if dirty.strip():
            raise ValueError('Commit frozen method/config before holdout inference')
        calibration = json.loads((ROOT / 'compat/semantic-memory/calibration.json').read_text(encoding='utf-8'))
        paths = ['src/agent-context.ts', 'src/semantic-memory.ts', 'src/embedding.ts', 'src/retrieval.ts',
                 'scripts/semantic-memory-data.ts', 'scripts/semantic-memory-evaluation.ts',
                 'scripts/semantic-memory-evaluate.ts', 'scripts/semantic-memory-embedding.py']
        if (calibration['status'] != 'admissible' or calibration['sourceDirty']
                or calibration['corpusDigest'] != DATA_DIGEST
                or calibration['modelDigest'] != ASSETS.sha(ASSETS.MANIFEST_BYTES)
                or calibration['sourceDigests'] != {path: ASSETS.sha((ROOT / path).read_bytes()) for path in paths}
                or calibration['vectorDigest'] != ASSETS.sha((ROOT / 'test/fixtures/semantic-memory-v1-development-vectors.json').read_bytes())):
            raise ValueError('Development calibration binding changed before holdout inference')
    for item in ASSETS.MANIFEST['files']:
        if not ASSETS.valid(ASSETS.artifact(item), item):
            raise ValueError('Missing/changed pinned local model assets')
    sys.path.insert(0, str(ASSETS.PACKAGES))
    import numpy as np
    import onnxruntime as ort
    from tokenizers import Tokenizer
    required = {'onnxruntime': '1.23.2', 'tokenizers': '0.23.3', 'numpy': '2.2.6'}
    versions = {name: importlib.metadata.version(name) for name in required}
    if versions != required:
        raise ValueError('Optional runtime differs from pinned versions')
    tokenizer = Tokenizer.from_file(str(ASSETS.MODEL / 'tokenizer.json'))
    tokenizer.no_truncation()
    tokenizer.no_padding()
    pad_id = tokenizer.token_to_id('<pad>')
    if pad_id is None:
        raise ValueError('Missing padding token')
    tokenizer.enable_padding(pad_id=pad_id, pad_token='<pad>')
    options = ort.SessionOptions()
    options.intra_op_num_threads = 1
    options.inter_op_num_threads = 1
    session = ort.InferenceSession(str(ASSETS.MODEL / ASSETS.MANIFEST['files'][0]['path']), sess_options=options, providers=['CPUExecutionProvider'])
    names = {item.name for item in session.get_inputs()}
    if not {'input_ids', 'attention_mask'}.issubset(names) or names - {'input_ids', 'attention_mask', 'token_type_ids'}:
        raise ValueError('Unexpected ONNX input contract')
    corpus = json.loads(DATA)
    requests = []
    for family in corpus['families']:
        if family['split'] != partition:
            continue
        ns = partition + '/' + family['id']
        requests.append(dict(namespace=ns + '/document', id='00000000-0000-4000-8000-000000000001', revision=2, text=family['title'] + '\n' + family['strategy']))
        requests.extend(dict(namespace=ns + '/fact', id=str(i), revision=2, text=fact['text']) for i, fact in enumerate(family['facts']))
        requests.extend(dict(namespace=ns + '/query', id=q['id'], revision=1, text=q['text']) for q in family['queries'])
        requests.extend(dict(namespace=ns + '/intent', id=key, revision=1, text=text) for key, text in corpus['intentAnchors'].items())
    if len(requests) != 84:
        raise ValueError('Unexpected fixed split size')
    entries = []
    passes = 0
    started = time.perf_counter()
    for offset in range(0, len(requests), 8):
        batch = requests[offset:offset + 8]
        encoded = tokenizer.encode_batch([item['text'] for item in batch])
        if any(len(item.ids) > ASSETS.MANIFEST['maxTokens'] for item in encoded):
            raise ValueError('Input exceeds model token limit; no silent truncation')
        feed = {'input_ids': np.array([item.ids for item in encoded], dtype=np.int64),
                'attention_mask': np.array([item.attention_mask for item in encoded], dtype=np.int64),
                'token_type_ids': np.array([item.type_ids for item in encoded], dtype=np.int64)}
        hidden = session.run(None, {key: value for key, value in feed.items() if key in names})[0]
        if hidden.shape != (len(batch), len(encoded[0].ids), ASSETS.MANIFEST['dimension']):
            raise ValueError('Unexpected hidden shape')
        mask = feed['attention_mask'][..., None].astype(np.float32)
        pooled = (hidden * mask).sum(axis=1) / mask.sum(axis=1)
        pooled /= np.linalg.norm(pooled, axis=1, keepdims=True)
        for request, vector in zip(batch, pooled):
            values = [round(float(value), 7) for value in vector]
            if not all(math.isfinite(value) for value in values) or math.hypot(*values) <= 0:
                raise ValueError('Invalid vector')
            entries.append({key: request[key] for key in ['namespace', 'id', 'revision']} | dict(textDigest=ASSETS.sha(request['text'].encode()), vector=values))
        passes += 1
    snapshot = dict(schemaVersion=1, modelDigest=ASSETS.sha(ASSETS.MANIFEST_BYTES), corpusDigest=DATA_DIGEST, dimension=ASSETS.MANIFEST['dimension'], split=partition, entries=entries,
                    provenance=dict(engine='onnxruntime/CPU/quantized-avx2/batch8/threads1', runtimeVersions=versions,
                                    inferenceSeconds=time.perf_counter() - started, texts=len(entries), forwardPasses=passes, paidHttpCalls=0, precision='round7'))
    directory = ROOT / '.probe-work/t072'
    directory.mkdir(parents=True, exist_ok=True)
    output = directory / (partition + '-vectors.json')
    with output.open('w', encoding='utf-8', newline='\n') as stream:
        stream.write(json.dumps(snapshot, ensure_ascii=False, separators=(',', ':')) + '\n')
    print(json.dumps(dict(split=partition, texts=len(entries), forwardPasses=passes, inferenceSeconds=snapshot['provenance']['inferenceSeconds'], sha256=ASSETS.sha(output.read_bytes()), paidHttpCalls=0)), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('split', choices=['development', 'holdout'])
    args = parser.parse_args()
    try:
        export(args.split)
    except (ImportError, ValueError) as error:
        parser.exit(1, 'Semantic embedding export failed: ' + str(error) + '\n')
