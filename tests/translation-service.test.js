'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_RESPONSE_LENGTH,
  MAX_TEXT_LENGTH,
  TranslationService,
  askScreenshotWithOpenAI,
  normalizeOpenAIEndpoint,
  parseOpenAIResponse,
  splitText,
  translateWithGoogle,
  translateWithBing,
  parseBingPage,
  translateWithOpenAI
} = require('../src/main/translation-service');

test('Bing translates with same-session cookies, bounded chunks and no redirects', async () => {
  const calls = [];
  const input = 'error '.repeat(250);
  const result = await translateWithBing({
    text: input,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith('/translator')) return {
        ok: true, status: 200,
        headers: { getSetCookie: () => ['session=test; Secure; HttpOnly'] },
        text: async () => 'IG:"ABC123"; var params_AbusePreventionHelper = [123,"token",999]; <div id="tta_outGDCont" data-iid="translator.1000">'
      };
      const form = new URLSearchParams(init.body);
      assert.equal(form.get('token'), 'token');
      assert.equal(form.get('key'), '123');
      assert.equal(init.headers.Cookie, 'session=test');
      assert.ok(form.get('text').length <= 1000);
      return jsonResponse([{ translations: [{ text: form.get('text').toUpperCase() }] }]);
    }
  });
  assert.equal(result, input.toUpperCase());
  assert.equal(calls.length, 3);
  assert.ok(calls.every(({ init }) => init.redirect === 'error'));
  assert.throws(() => parseBingPage('<html>captcha</html>'), { code: 'BING_SESSION_ERROR' });
});

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(data)
  };
}

test('Bing retries only its fixed global homepage when the CN homepage redirects abroad', async () => {
  const calls = [];
  const result = await translateWithBing({ text: 'error', fetchImpl: async (url, init) => {
    calls.push({ url, init });
    if (url === 'https://cn.bing.com/translator') throw new TypeError('Redirect was cancelled');
    if (url === 'https://www.bing.com/translator') return {
      ok: true, status: 200, text: async () => 'IG:"ABC123"; params_AbusePreventionHelper = [123,"token",999];'
    };
    assert.equal(new URL(url).origin, 'https://www.bing.com');
    assert.equal(init.headers.Origin, 'https://www.bing.com');
    return jsonResponse([{ translations: [{ text: '错误' }] }]);
  } });
  assert.equal(result, '错误');
  assert.equal(calls.length, 3);
  assert.equal(calls[0].init.body, undefined);
  assert.equal(calls[1].init.body, undefined);
  assert.ok(calls.every(({ init }) => init.redirect === 'error'));
});

test('OpenAI 端点规范化支持根地址、v1 和完整路径', () => {
  assert.equal(normalizeOpenAIEndpoint('https://api.openai.com'), 'https://api.openai.com/v1/chat/completions');
  assert.equal(normalizeOpenAIEndpoint('http://127.0.0.1:11434/v1/'), 'http://127.0.0.1:11434/v1/chat/completions');
  assert.equal(normalizeOpenAIEndpoint('http://[::1]:11434/v1'), 'http://[::1]:11434/v1/chat/completions');
  assert.equal(
    normalizeOpenAIEndpoint('https://example.test/api/v1/chat/completions?api-version=1'),
    'https://example.test/api/v1/chat/completions?api-version=1'
  );
  assert.throws(() => normalizeOpenAIEndpoint('file:///tmp/model'), { code: 'INVALID_ENDPOINT' });
  assert.throws(() => normalizeOpenAIEndpoint('https://name:secret@example.test/v1'), { code: 'INVALID_ENDPOINT' });
  assert.throws(() => normalizeOpenAIEndpoint('http://example.test/v1'), { code: 'INVALID_ENDPOINT' });
});

test('文本分块保留全部字符且不拆开代理对', () => {
  const input = `${'a'.repeat(17)}\n${'🚀'.repeat(12)} sentence end. ${'z'.repeat(20)}`;
  const chunks = splitText(input, 20);
  assert.equal(chunks.join(''), input);
  assert.ok(chunks.every((chunk) => chunk.length <= 20));
  for (const chunk of chunks.slice(0, -1)) {
    assert.doesNotMatch(chunk.at(-1), /[\uD800-\uDBFF]/);
  }
});

test('Google 免密钥翻译用 POST 分块并按顺序合并结果', async () => {
  const calls = [];
  const input = 'first line\nsecond line\nthird line';
  const fetchImpl = async (url, init) => {
    const source = new URLSearchParams(init.body).get('q');
    calls.push({ url, init, source });
    return jsonResponse([[[source.toUpperCase(), source]]]);
  };

  const result = await translateWithGoogle({ text: input, chunkLength: 12, fetchImpl });
  assert.equal(result, input.toUpperCase());
  assert.ok(calls.length >= 2);
  assert.ok(calls.every(({ init }) => init.method === 'POST'));
  assert.ok(calls.every(({ init }) => init.redirect === 'error'));
  assert.ok(calls.every(({ url }) => !new URL(url).searchParams.has('q')));
  assert.equal(calls.map(({ source }) => source).join(''), input);
});

test('Google 翻译支持 AbortSignal 与超时，并返回中文错误', async () => {
  const hangingFetch = (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
  });
  await assert.rejects(
    translateWithGoogle({ text: 'hello', fetchImpl: hangingFetch, timeoutMs: 5 }),
    (error) => error.code === 'TIMEOUT' && /超时/.test(error.message)
  );

  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(
    translateWithGoogle({ text: 'hello', fetchImpl: async () => { calls += 1; }, signal: controller.signal }),
    (error) => error.code === 'ABORTED' && /取消/.test(error.message)
  );
  assert.equal(calls, 0);
});

test('Google 多分块共用一个整体 deadline', async () => {
  let calls = 0;
  const fetchImpl = (_url, init) => new Promise((resolve, reject) => {
    calls += 1;
    const source = new URLSearchParams(init.body).get('q');
    const delay = calls === 1 ? 70 : 50;
    const timer = setTimeout(() => {
      init.signal.removeEventListener('abort', onAbort);
      resolve(jsonResponse([[[source.toUpperCase(), source]]]));
    }, delay);
    const onAbort = () => {
      clearTimeout(timer);
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    };
    init.signal.addEventListener('abort', onAbort, { once: true });
  });

  await assert.rejects(
    translateWithGoogle({ text: 'ab', chunkLength: 1, fetchImpl, timeoutMs: 100 }),
    { code: 'TIMEOUT' }
  );
  assert.ok(calls >= 1 && calls <= 2);
});

test('OpenAI 兼容文本翻译发送正确请求并解析文本数组', async () => {
  let request;
  const result = await translateWithOpenAI({
    text: 'TypeError: value is not iterable',
    endpoint: 'https://example.test/v1',
    apiKey: 'secret-key',
    model: 'example-model',
    fetchImpl: async (url, init) => {
      request = { url, init, body: JSON.parse(init.body) };
      return jsonResponse({ choices: [{ message: { content: [{ type: 'text', text: '类型错误：' }, { type: 'text', text: '值不可迭代' }] } }] });
    }
  });

  assert.equal(result, '类型错误：值不可迭代');
  assert.equal(request.url, 'https://example.test/v1/chat/completions');
  assert.equal(request.init.headers.Authorization, 'Bearer secret-key');
  assert.equal(request.init.redirect, 'error');
  assert.equal(request.body.model, 'example-model');
  assert.equal(request.body.messages[1].content, 'TypeError: value is not iterable');
});

test('OpenAI 输入超限时严格拒绝，不发起请求', async () => {
  let called = false;
  await assert.rejects(
    translateWithOpenAI({
      text: 'x'.repeat(MAX_TEXT_LENGTH + 1),
      fetchImpl: async () => { called = true; }
    }),
    { code: 'INPUT_TOO_LONG' }
  );
  assert.equal(called, false);
});

test('截图提问使用 image_url data URL、视觉模型和 OCR 参考文本', async () => {
  const imageDataUrl = `data:image/png;base64,${Buffer.from('image bytes').toString('base64')}`;
  let body;
  const answer = await askScreenshotWithOpenAI({
    imageDataUrl,
    question: '这是什么错误？',
    sourceText: 'MODULE_NOT_FOUND',
    endpoint: 'http://localhost:11434/v1',
    visionModel: 'local-vision:latest',
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body);
      return jsonResponse({ choices: [{ message: { content: '这是模块未找到错误。' } }] });
    }
  });

  assert.equal(answer, '这是模块未找到错误。');
  assert.equal(body.model, 'local-vision:latest');
  assert.equal(body.messages[1].content[1].type, 'image_url');
  assert.equal(body.messages[1].content[1].image_url.url, imageDataUrl);
  assert.match(body.messages[1].content[0].text, /MODULE_NOT_FOUND/);
  assert.equal(body.stream, false);
});

test('截图 data URL 不合法时拒绝，Google provider 不会隐式回退', async () => {
  await assert.rejects(
    askScreenshotWithOpenAI({ imageDataUrl: 'https://example.test/image.png' }),
    { code: 'INVALID_IMAGE' }
  );
  const service = new TranslationService({ fetchImpl: async () => jsonResponse({}) });
  await assert.rejects(
    service.askScreenshot({ provider: 'google', imageDataUrl: 'data:image/png;base64,YQ==' }),
    { code: 'VISION_PROVIDER_REQUIRED' }
  );
});

test('HTTP 错误和空响应均转为可读的中文错误', async () => {
  await assert.rejects(
    translateWithOpenAI({
      text: 'hello',
      endpoint: 'https://example.test/v1',
      fetchImpl: async () => jsonResponse({ error: { message: 'model not found' } }, 404)
    }),
    (error) => error.code === 'HTTP_ERROR' && /模型/.test(error.message) && /model not found/.test(error.message)
  );
  assert.throws(() => parseOpenAIResponse({ choices: [] }), { code: 'EMPTY_RESPONSE' });
});

test('非 JSON HTTP 错误保留状态和服务端摘要', async () => {
  await assert.rejects(
    translateWithOpenAI({
      text: 'hello',
      endpoint: 'https://example.test/v1',
      fetchImpl: async () => ({
        ok: false,
        status: 502,
        text: async () => 'upstream gateway unavailable'
      })
    }),
    (error) => error.code === 'HTTP_ERROR'
      && error.status === 502
      && /upstream gateway unavailable/.test(error.message)
  );
});

test('正常的分段字节流响应可完整解析', async () => {
  const payload = Buffer.from(JSON.stringify({
    choices: [{ message: { content: '流式读取正常' } }]
  }), 'utf8');
  const splitAt = payload.indexOf(Buffer.from('流', 'utf8')) + 1;
  const chunks = [payload.subarray(0, splitAt), payload.subarray(splitAt)];
  let index = 0;
  const result = await translateWithOpenAI({
    text: 'hello',
    endpoint: 'https://example.test/v1',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: {
        getReader: () => ({
          read: async () => index < chunks.length
            ? { done: false, value: chunks[index++] }
            : { done: true, value: undefined },
          releaseLock: () => {}
        })
      }
    })
  });
  assert.equal(result, '流式读取正常');
});

test('Content-Length 超限时不读取响应正文', async () => {
  let bodyRead = false;
  let bodyCanceled = false;
  await assert.rejects(
    translateWithOpenAI({
      text: 'hello',
      endpoint: 'https://example.test/v1',
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: {
          get: (name) => name.toLowerCase() === 'content-length' ? String(MAX_RESPONSE_LENGTH + 1) : null
        },
        body: { cancel: async () => { bodyCanceled = true; } },
        text: async () => {
          bodyRead = true;
          return '{}';
        }
      })
    }),
    { code: 'RESPONSE_TOO_LARGE' }
  );
  assert.equal(bodyRead, false);
  assert.equal(bodyCanceled, true);
});

test('流式响应读取超过上限时立即取消 reader', async () => {
  let canceled = false;
  let reads = 0;
  await assert.rejects(
    translateWithOpenAI({
      text: 'hello',
      endpoint: 'https://example.test/v1',
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        body: {
          getReader: () => ({
            read: async () => {
              reads += 1;
              return reads === 1
                ? { done: false, value: Buffer.alloc(MAX_RESPONSE_LENGTH + 1, 0x61) }
                : { done: true, value: undefined };
            },
            cancel: async () => { canceled = true; },
            releaseLock: () => {}
          })
        }
      })
    }),
    { code: 'RESPONSE_TOO_LARGE' }
  );
  assert.equal(canceled, true);
  assert.equal(reads, 1);
});
