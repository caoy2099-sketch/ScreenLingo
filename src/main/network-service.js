'use strict';

const net = require('node:net');

const DEFAULT_PROXY_URL = 'socks5://127.0.0.1:10808';

function isLoopback(hostname) {
  return ['localhost', '[::1]', '::1'].includes(hostname)
    || (net.isIP(hostname) === 4 && hostname.startsWith('127.'));
}

function normalizeProxyUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('代理地址无效，例如 socks5://127.0.0.1:10808。'); }
  if (!['http:', 'socks5:'].includes(url.protocol) || !isLoopback(url.hostname)
    || url.username || url.password || !url.port || Number(url.port) > 65535
    || !['', '/'].includes(url.pathname) || url.search || url.hash) {
    throw new Error('代理须为本机 HTTP 或 SOCKS5 地址，包含端口且不含账号信息。');
  }
  return `${url.protocol}//${url.host}`;
}

function probeProxy(proxyUrl, timeoutMs = 250) {
  const url = new URL(proxyUrl);
  return new Promise((resolve) => {
    let settled = false;
    const socket = net.connect({ host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port) });
    const finish = (available) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(available);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.on('error', () => finish(false));
    socket.on('end', () => finish(false));
    socket.on('connect', () => {
      if (url.protocol === 'socks5:') socket.write(Buffer.from([5, 1, 0]));
      else finish(true);
    });
    let greeting = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      greeting = Buffer.concat([greeting, chunk]);
      if (greeting.length >= 2) finish(greeting[0] === 5 && greeting[1] === 0);
    });
  });
}

class NetworkService {
  constructor({ session, probe = probeProxy }) {
    this.session = session;
    this.probe = probe;
    this.sessions = new Map();
  }

  getSession(key, proxyConfig) {
    if (!this.sessions.has(key)) {
      const session = this.session.fromPartition(`screenlingo-network-${this.sessions.size}`, { cache: false });
      const ready = session.setProxy(proxyConfig).then(() => session);
      this.sessions.set(key, ready);
    }
    return this.sessions.get(key);
  }

  async resolve(settings, targetUrl, { signal, timeoutMs = 5000 } = {}) {
    const cancelled = () => Object.assign(new Error('网络检测已取消。'), { code: 'ABORTED' });
    if (signal?.aborted) throw cancelled();
    let timer;
    let onAbort;
    const interrupted = new Promise((_, reject) => {
      onAbort = () => reject(cancelled());
      signal?.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => reject(Object.assign(
        new Error('代理检测超时，请重试或在网络设置中选择直连。'), { code: 'NETWORK_TIMEOUT' }
      )), timeoutMs);
    });
    try {
      return await Promise.race([this.selectRoute(settings, targetUrl), interrupted]);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  async selectRoute(settings, targetUrl) {
    const direct = () => this.getSession('direct', { mode: 'direct' });
    let selected;
    let label;
    const mode = settings.networkMode || 'auto';
    if (isLoopback(new URL(targetUrl).hostname) || mode === 'direct') {
      selected = await direct();
      label = '直连';
    } else if (mode === 'manual') {
      const proxyUrl = normalizeProxyUrl(settings.proxyUrl || DEFAULT_PROXY_URL);
      selected = await this.getSession(proxyUrl, { mode: 'fixed_servers', proxyRules: proxyUrl });
      label = `本机代理 :${new URL(proxyUrl).port}`;
    } else {
      const system = await this.getSession('system', { mode: 'system' });
      // Reload on each workflow so toggling v2rayN does not require restarting this app.
      await system.forceReloadProxyConfig?.();
      const rules = await system.resolveProxy(targetUrl);
      let usableSystem = rules && rules !== 'DIRECT';
      const firstRule = rules?.split(';')[0]?.trim();
      const localRule = /^(?:PROXY|HTTPS|SOCKS5?|SOCKS)\s+((?:127\.\d+\.\d+\.\d+|localhost):\d+)$/i.exec(firstRule || '');
      if (mode === 'auto' && localRule) {
        const protocol = /^SOCKS/i.test(firstRule) ? 'socks5' : 'http';
        usableSystem = await this.probe(`${protocol}://${localRule[1]}`);
      }
      if (mode === 'system' || usableSystem) {
        selected = system;
        label = usableSystem ? '系统代理' : '系统直连';
      } else {
        const candidates = [...new Set([settings.proxyUrl || DEFAULT_PROXY_URL, DEFAULT_PROXY_URL, 'http://127.0.0.1:10809'])];
        for (const candidate of candidates) {
          const proxyUrl = normalizeProxyUrl(candidate);
          if (await this.probe(proxyUrl)) {
            selected = await this.getSession(proxyUrl, { mode: 'fixed_servers', proxyRules: proxyUrl });
            label = `本机代理 :${new URL(proxyUrl).port}`;
            break;
          }
        }
        if (!selected) {
          selected = await direct();
          label = '直连';
        }
      }
    }
    return {
      label,
      fetchImpl: (url, init = {}) => selected.fetch(url, { ...init, credentials: 'include' })
    };
  }
}

module.exports = { DEFAULT_PROXY_URL, NetworkService, isLoopback, normalizeProxyUrl, probeProxy };
