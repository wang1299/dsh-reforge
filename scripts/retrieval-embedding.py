"""Optional local CPU embedding exporter for the frozen PUBLIC synthetic corpus only.

No DSH Store/profile/config or arbitrary input paths. `prepare` downloads public
artifacts; `export` verifies local artifacts and has no network operation.
"""
import argparse
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / '.probe-work'
MODEL = WORK / 't056-model'
PACKAGES = WORK / 't056-python-packages'
MANIFEST_BYTES = (ROOT / 'compat/retrieval-embedding/model.json').read_bytes()
MANIFEST = json.loads(MANIFEST_BYTES)
DATA_BYTES = (ROOT / 'test/fixtures/retrieval-v3-cases.json').read_bytes()
DATA_DIGEST = 'ae6a132ac1658a218e5770989246608ed7ab9ba5b766b751123958dd017db5ea'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def valid(path, item):
    if not path.is_file() or path.stat().st_size != item['bytes']:
        return False
    data = path.read_bytes()
    actual = sha(data) if 'sha256' in item else hashlib.sha1(
        b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
    return actual == item.get('sha256', item.get('gitBlobSha1'))


def artifact(item):
    path = (MODEL / item['path']).resolve()
    if not path.is_relative_to(MODEL.resolve()):
        raise ValueError('Model artifact outside local directory')
    return path


def prepare():
    for item in MANIFEST['files']:
        path = artifact(item)
        path.parent.mkdir(parents=True, exist_ok=True)
        if valid(path, item):
            print('verified ' + item['path'], flush=True)
            continue
        part = path.with_suffix(path.suffix + '.part')
        url = ('https://huggingface.co/' + MANIFEST['model'] + '/resolve/'
               + MANIFEST['revision'] + '/' + item['path'])
        with urllib.request.urlopen(url, timeout=60) as response, part.open('wb') as output:
            size = 0
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > item['bytes']:
                    raise ValueError('Artifact exceeds declared size')
                output.write(chunk)
        if not valid(part, item):
            raise ValueError('Artifact digest mismatch')
        os.replace(part, path)
        print('downloaded and verified ' + item['path'], flush=True)


def export(partition):
    if sha(DATA_BYTES) != DATA_DIGEST:
        raise ValueError('Frozen synthetic corpus changed')
    for item in MANIFEST['files']:
        if not valid(artifact(item), item):
            raise ValueError('Missing or changed local model; run prepare first')
    # Isolated optional packages, including portable Python builds without venv.
    sys.path.insert(0, str(PACKAGES))
    import numpy as np
    import onnxruntime as ort
    from tokenizers import Tokenizer
    required = {'onnxruntime': '1.23.2', 'tokenizers': '0.23.3', 'numpy': '2.2.6'}
    versions = {name: importlib.metadata.version(name) for name in required}
    if versions != required:
        raise ValueError('Optional runtime differs from pinned versions')
    tokenizer = Tokenizer.from_file(str(MODEL / 'tokenizer.json'))
    tokenizer.no_truncation()
    tokenizer.no_padding()
    pad_id = tokenizer.token_to_id('<pad>')
    if pad_id is None:
        raise ValueError('Missing tokenizer padding token')
    tokenizer.enable_padding(pad_id=pad_id, pad_token='<pad>')
    options = ort.SessionOptions()
    options.intra_op_num_threads = 1
    options.inter_op_num_threads = 1
    session = ort.InferenceSession(str(MODEL / MANIFEST['files'][0]['path']),
                                 sess_options=options, providers=['CPUExecutionProvider'])
    names = {item.name for item in session.get_inputs()}
    if not {'input_ids', 'attention_mask'}.issubset(names) or names - {'input_ids', 'attention_mask', 'token_type_ids'}:
        raise ValueError('Unexpected ONNX input contract')
    corpus = json.loads(DATA_BYTES)
    requests = [dict(namespace=partition + '/document', id=e['id'], revision=e['revision'],
                     text=e['title'] + '\n' + e['strategy'])
                for e in corpus['experiences'] if e['split'] == partition]
    requests += [dict(namespace=partition + '/query', id=q['id'], revision=1, text=q['text'])
                 for q in corpus['queries'] if q['split'] == partition]
    if len(requests) != 72:
        raise ValueError('Unexpected frozen split size')
    entries = []
    forward_passes = 0
    started = time.perf_counter()
    for offset in range(0, len(requests), 8):
        batch = requests[offset:offset + 8]
        encoded = tokenizer.encode_batch([item['text'] for item in batch])
        if any(len(item.ids) > MANIFEST['maxTokens'] for item in encoded):
            raise ValueError('Input exceeds model token limit; no silent truncation')
        feed = {'input_ids': np.array([item.ids for item in encoded], dtype=np.int64),
                'attention_mask': np.array([item.attention_mask for item in encoded], dtype=np.int64),
                'token_type_ids': np.array([item.type_ids for item in encoded], dtype=np.int64)}
        hidden = session.run(None, {key: value for key, value in feed.items() if key in names})[0]
        if hidden.shape != (len(batch), len(encoded[0].ids), MANIFEST['dimension']):
            raise ValueError('Unexpected ONNX hidden state shape')
        mask = feed['attention_mask'][..., None].astype(np.float32)
        pooled = (hidden * mask).sum(axis=1) / mask.sum(axis=1)
        pooled /= np.linalg.norm(pooled, axis=1, keepdims=True)
        for request, vector in zip(batch, pooled):
            values = [round(float(value), 7) for value in vector]
            if not all(math.isfinite(value) for value in values) or math.hypot(*values) <= 0:
                raise ValueError('Invalid exported vector')
            entries.append({key: request[key] for key in ['namespace', 'id', 'revision']}
                           | dict(textDigest=sha(request['text'].encode()), vector=values))
        forward_passes += 1
    snapshot = dict(schemaVersion=1, modelDigest=sha(MANIFEST_BYTES), corpusDigest=DATA_DIGEST,
                    dimension=MANIFEST['dimension'], split=partition, entries=entries,
                    provenance=dict(engine='onnxruntime/CPU/quantized-avx2/batch8/threads1',
                                    runtimeVersions=versions, inferenceSeconds=time.perf_counter() - started,
                                    texts=len(entries), forwardPasses=forward_passes,
                                    paidHttpCalls=0, precision='round7'))
    directory = WORK / 't056'
    directory.mkdir(parents=True, exist_ok=True)
    output = directory / (partition + '-vectors.json')
    # Explicit split prevents accidental holdout inference while preparing development.
    output.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    print(json.dumps(dict(split=partition, entries=len(entries), sha256=sha(output.read_bytes()),
                          inferenceSeconds=snapshot['provenance']['inferenceSeconds'],
                          forwardPasses=forward_passes, paidHttpCalls=0)), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['prepare', 'export-development', 'export-holdout'])
    args = parser.parse_args()
    try:
        prepare() if args.command == 'prepare' else export(args.command.removeprefix('export-'))
    except (ImportError, ValueError) as error:
        parser.exit(1, 'Embedding preparation/export failed: ' + str(error) + '\n')
