import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContext, Script } from 'node:vm';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { renderPanel } from '../src/panel-view.js';
import { bridgeRequest } from '../src/native-bridge.js';

test('native child uses correlated messages without fetch, token exchange or unknown write replay', async () => {
  const html = renderPanel('test-nonce', { channel: 'fixture', parentOrigin: 'http://127.0.0.1:1234' });
  assert.match(html, /default-src 'none'/); assert.match(html, /connect-src|default-src/);
  assert.ok(!html.includes('allow-same-origin')); assert.ok(!html.includes('http://127.0.0.1:57942'));
  const script = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)![1]!;
  const prefix = script.slice(0, script.indexOf('let state='));
  let listener: (e: object) => void = () => undefined;
  const outbox: { data: { id: string }; origin: string }[] = []; const timers: (() => void)[] = [];
  const parent = { postMessage: (data: { id: string }, origin: string) => { outbox.push({ data, origin }); } };
  const context = createContext({ URLSearchParams, Map, Error, crypto: { randomUUID }, parent,
    window: { addEventListener: (_name: string, fn: typeof listener) => { listener = fn; } },
    setTimeout: (fn: () => void) => { timers.push(fn); return timers.length; }, clearTimeout: () => undefined,
    fetch: () => { throw Error('Native view must not fetch'); } });
  new Script(prefix).runInContext(context);
  const response = new Script("nativeRequest('/api/state','GET')").runInContext(context) as Promise<unknown>;
  const id = outbox[0]!.data.id;
  listener({ source: {}, origin: 'http://127.0.0.1:1234', data: { channel: 'fixture', id, ok: true, value: 'spoofed' } });
  listener({ source: parent, origin: 'http://attacker.invalid', data: { channel: 'fixture', id, ok: true, value: 'spoofed' } });
  listener({ source: parent, origin: 'http://127.0.0.1:1234', data: { channel: 'fixture', id, ok: true, value: 'actual' } });
  assert.equal(await response, 'actual'); assert.equal(outbox[0]!.origin, 'http://127.0.0.1:1234');
  const write = new Script("nativeRequest('/api/cleanup','POST',{})").runInContext(context) as Promise<unknown>;
  const rejected = assert.rejects(write, /不会自动重试/); timers[1]!(); await rejected;
  assert.equal(outbox.length, 2);
  assert.equal(bridgeRequest({ ...outbox[0]!.data, channel: 'wrong', path: '/api/state', method: 'GET' }, 'fixture'), null);
  assert.equal(bridgeRequest({ channel: 'fixture', id, path: '/api/state', method: 'GET', extra: true }, 'fixture'), null);
  assert.equal(bridgeRequest({ channel: 'fixture', id, path: '/api/state', method: 'GET' }, 'fixture')?.id, id);
});

test('native theme accepts only its parent and bounded appearance, and changes no form state', () => {
  const html = renderPanel('theme-nonce', { channel: 'theme-channel', parentOrigin: 'http://host' });
  assert.match(html, /--evolve-background/); assert.match(html, /\.hero>div:first-child\{display:none\}/);
  assert.ok(!renderPanel('standalone').includes('.hero>div:first-child{display:none}'));
  const script = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)![1]!;
  const prefix = script.slice(0, script.indexOf('let state='));
  const values = new Map<string, string>(); const style = { setProperty: (key: string, value: string) => values.set(key, value), colorScheme: '' };
  const draft = { value: '尚未保存的人工修订', revision: 2 }; let listener: (event: object) => void = () => undefined;
  const parent = { postMessage: () => assert.fail('Theme must not send requests') };
  const context = createContext({ URLSearchParams, Map, Error, crypto: { randomUUID }, parent, setTimeout, clearTimeout,
    CSS: { supports: (_key: string, color: string) => /^#[0-9a-f]{6}$/i.test(color) },
    document: { documentElement: { style }, getElementById: () => assert.fail('Theme must not rebuild or read forms') },
    window: { addEventListener: (_name: string, fn: typeof listener) => { listener = fn; } }, draft });
  new Script(prefix).runInContext(context);
  const appearance = { dark: true, fontSize: 15, background: '#171717', surface: '#222222', text: '#eeeeee', muted: '#aaaaaa', border: '#393939', accent: '#879bff', success: '#65be83', warning: '#e8b65b', danger: '#f58b8b' };
  const send = (data: object, source: unknown = parent, origin = 'http://host') => listener({ source, origin, data: { channel: 'theme-channel', type: 'theme', appearance: data } });
  send(appearance, { postMessage: () => undefined }); send(appearance, parent, 'http://attacker');
  send({ ...appearance, extra: '#ffffff' }); send({ ...appearance, fontSize: 10000 }); send({ ...appearance, background: 'url(https://attacker)' });
  assert.equal(values.size, 0);
  send(appearance); assert.equal(values.get('--evolve-background'), '#171717'); assert.equal(style.colorScheme, 'dark');
  send({ ...appearance, dark: false, background: '#ffffff' }); assert.equal(values.get('--evolve-background'), '#ffffff'); assert.equal(style.colorScheme, 'light');
  assert.deepEqual(draft, { value: '尚未保存的人工修订', revision: 2 });
});

test('shipped client registers the official settings, main and conversation slots with scoped disposal', async () => {
  const text = await readFile('dist/src/client.js', 'utf8'); let module: { apply: (ctx: unknown) => void; inject: string[] } | undefined;
  const require = createRequire(import.meta.url);
  new Script(text).runInContext(createContext({ window: { __ModuleLoader__: { load: (entry: { id: string; factory: (require: (name: string) => unknown) => typeof module }) => {
    assert.equal(entry.id, 'dsh-reforge'); module = entry.factory(require);
  } } } }));
  assert.ok(module); assert.deepEqual([...module.inject], ['slots', 'connection', 'layout']);
  const entries: Record<string, unknown>[] = []; const disposers: (() => void)[] = []; const navigation: unknown[] = [];
  module.apply({ connection: {}, slots: { inject: (_slot: string, fn: () => unknown) => fn(), register: (options: Record<string, unknown>) => { entries.push(options); return () => undefined; } },
    layout: { panelInfo: { getSnapshot: () => ({ activePanelId: 'dsh-reforge' }) }, selectPanel: (id: unknown) => navigation.push(id) },
    effect: (fn: () => () => void) => disposers.push(fn()) });
  assert.deepEqual(entries.map(e => e.name), ['main', 'settings.plugins.tab', 'plugins.bundle.config', 'conversation.view']);
  assert.equal(entries.find(e => e.name === 'conversation.view')?.label, '经验');
  assert.equal(entries.find(e => e.name === 'plugins.bundle.config')?.key, 'dsh-reforge');
  disposers.forEach(fn => fn()); assert.deepEqual(navigation, [null]);
});

test('a working-day of native polling never exhausts writes, and duplicate writes are not replayed', async () => {
  let exported: { apply: (ctx: unknown) => void } | undefined; let main: () => { type: (props: unknown) => unknown; props: unknown };
  let listener: (event: unknown) => void = () => undefined; let forwarded = 0;
  const replies: { id: string; ok: boolean; message?: string }[] = [];
  const contentWindow = { postMessage: (reply: typeof replies[number]) => { if (reply.id) replies.push(reply); } }; const frame = { contentWindow, srcdoc: '', addEventListener: () => undefined, removeEventListener: () => undefined };
  const info = { repositoryId: 'fixture-repo', repositoryName: 'fixture', version: 1 };
  const connection = { rpc: { call: async (_channel: string, endpoint: string) => { if (endpoint === 'dsh-reforge-request') forwarded++; return { ok: true, value: info }; } } };
  const effects: (() => void)[] = [];
  const react = { createElement: (type: unknown, props: unknown) => ({ type, props }), useRef: () => ({ current: frame }), useState: (value: unknown) => [value === null ? info : value, () => undefined], useEffect: (fn: () => void) => { effects.push(fn); } };
  const text = await readFile('dist/src/client.js', 'utf8');
  new Script(text).runInContext(createContext({ crypto: { randomUUID }, AbortController,
    document: { body: { hasAttribute: () => false } }, getComputedStyle: () => ({ getPropertyValue: () => '' }), MutationObserver: class { observe() {} disconnect() {} },
    window: { location: { origin: 'http://fixture' }, addEventListener: (_name: string, fn: typeof listener) => { listener = fn; }, removeEventListener: () => undefined,
      __ModuleLoader__: { load: (entry: { factory: (require: () => unknown) => typeof exported }) => { exported = entry.factory(() => react); } } } }));
  exported!.apply({ connection, layout: {}, slots: { inject: (_name: string, fn: () => void) => fn(), register: (options: { name: string }, view: typeof main) => { if (options.name === 'main') main = view; } }, effect: () => undefined });
  const view = main!(); view.type(view.props); effects.forEach(fn => fn());
  const bridge = frame.srcdoc.match(/const nativeBridge=(\{[^\n]+?\});/)![1]!; const channel = (JSON.parse(bridge) as { channel: string }).channel;
  const send = async (method: string, id = randomUUID()) => { listener({ source: contentWindow, origin: 'null', data: { channel, id, path: '/api/state', method } }); await Promise.resolve(); await Promise.resolve(); return id; };
  for (let i = 0; i < 4097; i++) await send('GET');
  assert.equal(forwarded, 4097);
  const id = await send('POST'); await send('POST', id); assert.equal(forwarded, 4098);
  assert.ok(replies.some(r => r.id === id && !r.ok));
  for (let i = 0; i < 4095; i++) await send('POST');
  const full = await send('POST'); assert.ok(replies.some(r => r.id === full && !r.ok && r.message?.includes('上限')));
  const beforeRead = forwarded; await send('GET'); assert.equal(forwarded, beforeRead + 1);
});
