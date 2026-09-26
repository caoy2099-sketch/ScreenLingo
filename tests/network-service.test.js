'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { NetworkService, normalizeProxyUrl } = require('../src/main/network-service');

function harness() {
  let proxyOn = false;
  let systemRule = 'DIRECT';
  const service = new NetworkService({
    probe: async () => proxyOn,
    session: {
      fromPartition() {
        let config;
        return {
          setProxy: async (value) => { config = value; },
          forceReloadProxyConfig: async () => {},
          resolveProxy: async () => systemRule,
          fetch: async (url, init) => ({ url, init, config })
        };
      }
    }
  });
  return { service, setProxy: (value) => { proxyOn = value; }, setSystem: (value) => { systemRule = value; } };
}

test('automatic networking switches between direct and v2rayN without restarting', async () => {
  const h = harness();
  assert.equal((await h.service.resolve({}, 'https://cn.bing.com')).label, '直连');
  h.setProxy(true);
  const on = await h.service.resolve({}, 'https://cn.bing.com');
  assert.match(on.label, /10808/);
  assert.equal((await on.fetchImpl('https://cn.bing.com')).config.proxyRules, 'socks5://127.0.0.1:10808');
  h.setProxy(false);
  assert.equal((await h.service.resolve({}, 'https://cn.bing.com')).label, '直连');
});

test('automatic mode respects active system proxy and handles its stopped local listener', async () => {
  const h = harness();
  h.setSystem('PROXY 127.0.0.1:10809');
  h.setProxy(true);
  assert.equal((await h.service.resolve({}, 'https://cn.bing.com')).label, '系统代理');
  h.setProxy(false);
  assert.equal((await h.service.resolve({}, 'https://cn.bing.com')).label, '直连');
});

test('forced direct and local model requests bypass an available proxy', async () => {
  const h = harness();
  h.setProxy(true);
  for (const [settings, url] of [
    [{ networkMode: 'direct' }, 'https://cn.bing.com'],
    [{ networkMode: 'manual' }, 'http://127.0.0.1:11434/v1']
  ]) {
    const route = await h.service.resolve(settings, url);
    assert.equal((await route.fetchImpl(url)).config.mode, 'direct');
  }
});

test('manual mode retains the chosen local proxy and includes cookies for web translation', async () => {
  const { service } = harness();
  const route = await service.resolve({ networkMode: 'manual', proxyUrl: 'http://127.0.0.1:12345' }, 'https://cn.bing.com');
  const result = await route.fetchImpl('https://cn.bing.com', { redirect: 'error' });
  assert.equal(result.config.proxyRules, 'http://127.0.0.1:12345');
  assert.equal(result.init.credentials, 'include');
  assert.equal(result.init.redirect, 'error');
});

test('proxy addresses must be valid local HTTP or SOCKS5 listeners', () => {
  assert.equal(normalizeProxyUrl('socks5://127.0.0.1:10808/'), 'socks5://127.0.0.1:10808');
  for (const value of ['http://127.evil.test:10808', 'http://example.test:8080', 'file:///tmp', 'socks5://user:secret@localhost:10808', 'http://127.0.0.1:70000']) {
    assert.throws(() => normalizeProxyUrl(value));
  }
});

test('unresponsive system proxy detection has a deadline and supports cancellation', async () => {
  const service = new NetworkService({ session: {
    fromPartition: () => ({ setProxy: () => new Promise(() => {}) })
  } });
  await assert.rejects(service.resolve({}, 'https://cn.bing.com', { timeoutMs: 15 }), { code: 'NETWORK_TIMEOUT' });
  const controller = new AbortController();
  const pending = service.resolve({}, 'https://cn.bing.com', { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { code: 'ABORTED' });
  await assert.rejects(service.resolve({}, 'https://cn.bing.com', { signal: controller.signal }), { code: 'ABORTED' });
});
