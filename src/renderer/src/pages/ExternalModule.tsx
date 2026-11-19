import { Alert, Card, Spin } from 'antd'
import { useEffect, useMemo, useRef, useState } from 'react'

const bridgeScript = `<script>
(() => {
  let sequence = 0;
  const pending = new Map();
  const listeners = new Map();
  window.miniapp = {
    invoke(action, payload) {
      return new Promise((resolve, reject) => {
        const requestId = ++sequence;
        pending.set(requestId, { resolve, reject });
        window.parent.postMessage({ type: 'miniapp:invoke', requestId, action, payload }, '*');
      });
    },
    on(event, callback) {
      const callbacks = listeners.get(event) || new Set();
      callbacks.add(callback);
      listeners.set(event, callbacks);
      window.parent.postMessage({ type: 'miniapp:subscribe', event }, '*');
      return () => {
        callbacks.delete(callback);
        if (!callbacks.size) {
          listeners.delete(event);
          window.parent.postMessage({ type: 'miniapp:unsubscribe', event }, '*');
        }
      };
    }
  };
  window.addEventListener('message', (event) => {
    if (event.source !== window.parent || !event.data) return;
    const message = event.data;
    if (message.type === 'miniapp:response') {
      const request = pending.get(message.requestId);
      if (!request) return;
      pending.delete(message.requestId);
      if (message.error) request.reject(new Error(message.error));
      else request.resolve(message.result);
    } else if (message.type === 'miniapp:event') {
      for (const callback of listeners.get(message.event) || []) callback(message.payload);
    }
  });
})();
</script>`

function describeError(error: unknown): string {
  return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(error)
}

export function ExternalModule({ id }: { id: string }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [html, setHtml] = useState('')
  const [error, setError] = useState('')
  const source = useMemo(() => html ? (/<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (match) => `${match}${bridgeScript}`) : `${bridgeScript}${html}`) : '', [html])

  useEffect(() => {
    setHtml('')
    setError('')
    void window.desktop?.moduleManager.getUi(id).then(setHtml).catch((cause) => setError(describeError(cause)))
  }, [id])

  useEffect(() => {
    const api = window.desktop?.modules
    if (!api) return
    const subscriptions = new Map<string, () => void>()
    const send = (message: unknown) => frame.current?.contentWindow?.postMessage(message, '*')
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || !event.data || typeof event.data !== 'object') return
      const data = event.data as { type?: string; action?: string; event?: string; requestId?: number; payload?: unknown }
      if (data.type === 'miniapp:invoke' && typeof data.action === 'string' && /^[a-z][a-z0-9-]*$/.test(data.action) && Number.isSafeInteger(data.requestId)) {
        void api.invoke(id, data.action, data.payload).then((result) => send({ type: 'miniapp:response', requestId: data.requestId, result })).catch((cause) => send({ type: 'miniapp:response', requestId: data.requestId, error: describeError(cause) }))
      } else if (data.type === 'miniapp:subscribe' && typeof data.event === 'string' && /^[a-z][a-z0-9-]*$/.test(data.event) && subscriptions.size < 50 && !subscriptions.has(data.event)) {
        subscriptions.set(data.event, api.on(id, data.event, (payload) => send({ type: 'miniapp:event', event: data.event, payload })))
      } else if (data.type === 'miniapp:unsubscribe' && typeof data.event === 'string') {
        subscriptions.get(data.event)?.()
        subscriptions.delete(data.event)
      }
    }
    window.addEventListener('message', receive)
    return () => { window.removeEventListener('message', receive); subscriptions.forEach((unsubscribe) => unsubscribe()) }
  }, [id])

  return <div className="page-content external-module-page">{error ? <Alert type="error" showIcon title="Could not load module" description={error} /> : source ? <Card className="external-module-card"><iframe ref={frame} title={id} srcDoc={source} sandbox="allow-scripts" /></Card> : <div className="external-module-loading"><Spin /> Loading module…</div>}</div>
}
