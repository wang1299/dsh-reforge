"""Local vectors for the fixed public T059 corpus; no arbitrary input/profile/API.

Reuses verified T056 model assets and optional packages without modifying its
frozen exporter. Preparation is explicit: retrieval-embedding.py prepare.
"""
import argparse
import importlib.metadata
import importlib.util
import json
import math
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('frozen_embedding_assets', ROOT / 'scripts/retrieval-embedding.py')
ASSETS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ASSETS)
DATA = (ROOT / 'test/fixtures/project-facts-v1-cases.json').read_bytes()
DATA_DIGEST = '44b0990bbc0e168666640a7c6ecb72625233bf9d49f1750c8fcdcb09b4955454'


def export(partition):
    if ASSETS.sha(DATA) != DATA_DIGEST:
        raise ValueError('Frozen project-facts corpus changed')
    for item in ASSETS.MANIFEST['files']:
        if not ASSETS.valid(ASSETS.artifact(item), item):
            raise ValueError('Missing/changed model; run retrieval-embedding.py prepare')
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
    session = ort.InferenceSession(str(ASSETS.MODEL / ASSETS.MANIFEST['files'][0]['path']),
                                 sess_options=options, providers=['CPUExecutionProvider'])
    names = {item.name for item in session.get_inputs()}
    if not {'input_ids', 'attention_mask'}.issubset(names) or names - {'input_ids', 'attention_mask', 'token_type_ids'}:
        raise ValueError('Unexpected ONNX input contract')
    corpus = json.loads(DATA)
    requests = [dict(namespace=partition + '/document', id=e['id'], revision=e['revision'], text=e['title'] + '\n' + e['strategy'])
                for e in corpus['experiences'] if e['split'] == partition]
    requests += [dict(namespace=partition + '/query', id=q['id'], revision=1, text=q['text'])
                 for q in corpus['queries'] if q['split'] == partition]
    if len(requests) != 56:
        raise ValueError('Unexpected fixed split size')
    # Identical text is inferred once, so counterfactual pairs differ only in
    # task facts, never padding/quantization variation between inference batches.
    texts = list(dict.fromkeys(item['text'] for item in requests))
    vectors = {}
    passes = 0
    started = time.perf_counter()
    for offset in range(0, len(texts), 8):
        batch = texts[offset:offset + 8]
        encoded = tokenizer.encode_batch(batch)
        if any(len(item.ids) > ASSETS.MANIFEST['maxTokens'] for item in encoded):
            raise ValueError('Input exceeds token limit; no silent truncation')
        feed = {'input_ids': np.array([item.ids for item in encoded], dtype=np.int64),
                'attention_mask': np.array([item.attention_mask for item in encoded], dtype=np.int64),
                'token_type_ids': np.array([item.type_ids for item in encoded], dtype=np.int64)}
        hidden = session.run(None, {key: value for key, value in feed.items() if key in names})[0]
        if hidden.shape != (len(batch), len(encoded[0].ids), ASSETS.MANIFEST['dimension']):
            raise ValueError('Unexpected hidden state shape')
        mask = feed['attention_mask'][..., None].astype(np.float32)
        pooled = (hidden * mask).sum(axis=1) / mask.sum(axis=1)
        pooled /= np.linalg.norm(pooled, axis=1, keepdims=True)
        for text, vector in zip(batch, pooled):
            values = [round(float(value), 7) for value in vector]
            if not all(math.isfinite(value) for value in values) or math.hypot(*values) <= 0:
                raise ValueError('Invalid vector')
            vectors[text] = values
        passes += 1
    entries = [{key: request[key] for key in ['namespace', 'id', 'revision']}
               | dict(textDigest=ASSETS.sha(request['text'].encode()), vector=vectors[request['text']]) for request in requests]
    snapshot = dict(schemaVersion=1, modelDigest=ASSETS.sha(ASSETS.MANIFEST_BYTES), corpusDigest=DATA_DIGEST,
                    dimension=384, split=partition, entries=entries,
                    provenance=dict(engine='onnxruntime/CPU/quantized-avx2/batch8/threads1/dedup-text', runtimeVersions=versions,
                                    inferenceSeconds=time.perf_counter() - started, texts=len(texts), forwardPasses=passes,
                                    paidHttpCalls=0, precision='round7'))
    directory = ROOT / '.probe-work/t059'
    directory.mkdir(parents=True, exist_ok=True)
    output = directory / (partition + '-vectors.json')
    with output.open('w', encoding='utf-8', newline='\n') as stream:
        stream.write(json.dumps(snapshot, ensure_ascii=False, separators=(',', ':')) + '\n')
    print(json.dumps(dict(split=partition, entries=len(entries), uniqueTexts=len(texts), passes=passes,
                          inferenceSeconds=snapshot['provenance']['inferenceSeconds'], sha256=ASSETS.sha(output.read_bytes()), paidApiCalls=0)))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('split', choices=['development', 'holdout'])
    args = parser.parse_args()
    try:
        export(args.split)
    except (ImportError, ValueError) as error:
        parser.exit(1, 'Local export failed: ' + str(error) + '\n')
