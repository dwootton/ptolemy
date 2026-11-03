const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildSync } = require('esbuild');
const vm = require('node:vm');
const bundle = buildSync({ entryPoints: ['webview-ui/src/utilities/studySurveyUrl.ts'], bundle: true, platform: 'node', format: 'cjs', write: false });
const context = { module: { exports: {} }, URL };
vm.runInNewContext(bundle.outputFiles[0].text, context);
const { studySurveyUrl } = context.module.exports;

test('study links require an explicitly configured HTTP(S) destination', () => {
  for (const url of [undefined, '', 'not a url', 'javascript:alert(1)', 'file:///tmp/study']) {
    assert.equal(studySurveyUrl(url, { participantId: 'P1' }), undefined);
  }
});

test('study links preserve configured parameters and encode participant context', () => {
  const result = new URL(studySurveyUrl('https://example.org/survey?lang=en', { type: 'Survey', participantId: 'P 1' }));
  assert.equal(result.origin, 'https://example.org');
  assert.equal(result.searchParams.get('lang'), 'en');
  assert.equal(result.searchParams.get('participantId'), 'P 1');
  assert.equal(result.searchParams.get('type'), 'Survey');
});
