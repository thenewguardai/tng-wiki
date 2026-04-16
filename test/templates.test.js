import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getTemplate } from '../src/templates/index.js';

const DOMAINS = [
  'ai-research',
  'competitive-intel',
  'publication',
  'business-ops',
  'learning',
  'software-engineering',
  'blank',
];

test('getTemplate returns the blank template for unknown domains', () => {
  assert.equal(getTemplate('does-not-exist'), getTemplate('blank'));
});

for (const domain of DOMAINS) {
  test(`template[${domain}] has the expected shape`, () => {
    const t = getTemplate(domain);

    assert.ok(Array.isArray(t.extraDirs), 'extraDirs must be an array');
    for (const d of t.extraDirs) {
      assert.equal(typeof d, 'string');
      assert.ok(!d.startsWith('/'), `extraDirs entries must be relative: ${d}`);
    }

    assert.equal(typeof t.indexMd, 'function');
    assert.equal(typeof t.logMd, 'function');
    assert.equal(typeof t.extraFiles, 'object');
    assert.ok(t.extraFiles !== null);

    if (t.seedSource !== null && t.seedSource !== undefined) {
      assert.equal(typeof t.seedSource.path, 'string');
      assert.equal(typeof t.seedSource.content, 'string');
      assert.ok(!t.seedSource.path.startsWith('/'), 'seed path must be relative');
    }
  });

  test(`template[${domain}].indexMd embeds the wiki name`, () => {
    const out = getTemplate(domain).indexMd('Zephyr Wiki');
    assert.match(out, /Zephyr Wiki/);
    assert.match(out, /^# Zephyr Wiki/);
  });

  test(`template[${domain}].logMd embeds the wiki name, domain, and an ISO date`, () => {
    const out = getTemplate(domain).logMd('Zephyr Wiki', domain);
    assert.match(out, /Zephyr Wiki/);
    assert.match(out, new RegExp(domain));
    assert.match(out, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  test(`template[${domain}].extraFiles entries all have relative paths and string contents`, () => {
    const t = getTemplate(domain);
    for (const [path, content] of Object.entries(t.extraFiles)) {
      assert.ok(!path.startsWith('/'), `extraFiles path must be relative: ${path}`);
      assert.equal(typeof content, 'string');
      assert.ok(content.length > 0, `extraFiles entry ${path} must not be empty`);
    }
  });
}
