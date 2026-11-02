import { createElement as h, useEffect, useRef, useState } from 'react';
import type { Context } from '@deepseek-ai/cordis';
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client';
import type { ILayout, MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client';
import type {} from '@deepseek-ai/dsh-client-ui-settings/client';
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type {} from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import { renderPanel } from './panel-view.js';
import { bridgeRequest } from './native-bridge.js';
import { watchNativeTheme } from './native-theme.js';
import { packageName } from './identity.js';
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client';

export const name = 'dsh-reforge-client';
export const inject = ['slots', 'connection', 'layout'];
const channel = '/api'; const mainId = 'dsh-reforge' as MainPanelId;
interface Info { repositoryId: string; repositoryName: string; version: number }
type Face = { connection: ConnectionHandle; layout: ILayout };

function NativeView({ connection, layout, inSettings = false }: Face & { inSettings?: boolean }) {
  const frame = useRef<HTMLIFrameElement>(null); const [info, setInfo] = useState<Info | null>(null); const [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController(); let live = true;
    void connection.rpc.call(channel, 'dsh-reforge-info', {}, abort.signal).then(result => {
      if (!live) return;
      if (result.ok) setInfo(result.value as Info); else setError(result.error.message);
    }).catch(() => { if (live) setError('暂时无法连接 DSH 插件，请关闭后重新打开。'); });
    return () => { live = false; abort.abort(); };
  }, [connection]);
  useEffect(() => {
    if (!info || !frame.current) return;
    const target = frame.current; const session = crypto.randomUUID(); const nonce = crypto.randomUUID().replaceAll('-', '');
    const abort = new AbortController(); const writes = new Set<string>(); const pending = new Set<string>(); let live = true;
    const listener = (event: MessageEvent) => {
      if (!live || event.source !== target.contentWindow || event.origin !== 'null') return;
      const request = bridgeRequest(event.data, session); if (!request || pending.has(request.id)) return;
      const refuse = (message: string) => target.contentWindow?.postMessage({ channel: session, id: request.id, ok: false, message }, '*');
      // Read polling must not consume the bounded no-replay ledger for writes.
      if (request.method === 'POST' && writes.has(request.id)) { refuse('此保存请求已经发送过，请刷新核对结果；不会重复执行。'); return; }
      if (request.method === 'POST' && writes.size >= 4096) { refuse('本页保存次数已达上限，请核对结果后关闭并重新打开。'); return; }
      if (pending.size >= 16) { refuse('请求较多，请等待当前操作完成后再试。'); return; }
      if (request.method === 'POST') writes.add(request.id);
      pending.add(request.id);
      void connection.rpc.call(channel, 'dsh-reforge-request', { repositoryId: info.repositoryId, path: request.path, method: request.method, ...(request.data === undefined ? {} : { data: request.data }) }, abort.signal)
        .then(result => {
          if (!live || event.source !== target.contentWindow) return;
          target.contentWindow?.postMessage({ channel: session, id: request.id, ok: result.ok, ...(result.ok ? { value: result.value } : { message: result.error.message }) }, '*');
        }).catch(() => {
          if (live) target.contentWindow?.postMessage({ channel: session, id: request.id, ok: false, message: request.method === 'POST' ? '保存回执中断，请刷新核对结果；不会自动重试。' : 'DSH 连接中断，请稍后刷新。' }, '*');
        }).finally(() => { pending.delete(request.id); });
    };
    window.addEventListener('message', listener);
    target.srcdoc = renderPanel(nonce, { channel: session, parentOrigin: window.location.origin });
    const stopTheme = watchNativeTheme(target, session);
    return () => { live = false; abort.abort(); stopTheme(); window.removeEventListener('message', listener); };
  }, [connection, info]);
  return h('section', { style: { width: '100%', height: '100%', minHeight: 400, display: 'flex', flexDirection: 'column' } },
    h('header', { style: { padding: '8px 12px', display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', font: 'inherit', color: 'var(--dsw-alias-label-secondary)' } },
      !inSettings && h('button', { type: 'button', style: { font: 'inherit', padding: '6px 10px', borderRadius: 8, border: '1px solid var(--dsw-alias-border-l3)', color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-bg-layer-2)', cursor: 'pointer' }, onClick: () => layout.selectPanel(null) }, '← 返回对话'),
      h('span', null, info ? '绑定仓库：' + info.repositoryName : '正在连接 DSH-Reforge')),
    error ? h('p', { role: 'alert' }, error) : h('iframe', { ref: frame, title: 'DSH-Reforge 经验与学习动态', sandbox: 'allow-scripts', style: { border: 0, width: '100%', flex: 1, minHeight: '70vh', background: 'transparent', padding: '0 12px' } }));
}

// Browser and host connection augment the same Cordis symbol in this monorepo.
// Narrow the browser face to the published client contract at this entry point.
export function apply(ctx: Omit<Context, 'connection'> & { connection: ConnectionHandle }): void {
  const face: Face = { connection: ctx.connection, layout: ctx.layout };
  const View = () => h(NativeView, face);
  const SettingsView = () => h(NativeView, { ...face, inSettings: true });
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'dsh-reforge' }, View));
  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({ name: 'settings.plugins.tab', id: 'dsh-reforge', label: 'DSH-Reforge', order: 25 }, SettingsView));
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({ name: 'plugins.bundle.config', key: packageName }, SettingsView));
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({ name: 'conversation.session.header.actions', id: 'dsh-reforge', order: 25 }, function Entry(props) {
    const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
    const open = async () => {
      setBusy(true); setError('');
      try {
        const result = await face.connection.rpc.call(channel, 'dsh-reforge-info', { sessionId: props.sessionId });
        if (result.ok) face.layout.selectPanel(mainId); else setError(result.error.message);
      } catch { setError('暂时无法连接 DSH 插件。'); } finally { setBusy(false); }
    };
    return h('span', null, h('button', { type: 'button', disabled: busy, onClick: () => { void open(); }, title: '查看当前配置仓库的经验与学习动态' }, '经验'), error && h('span', { role: 'status' }, error));
  }));
  ctx.effect(() => () => { if (ctx.layout.panelInfo.getSnapshot().activePanelId === mainId) ctx.layout.selectPanel(null); }, 'dsh-reforge:native-navigation');
}
