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
  'code-archaeology',
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

// --- code-archaeology specifics (issue #22) ---

test('template[code-archaeology] scaffolds the campaign layout, not the SE shape', () => {
  const t = getTemplate('code-archaeology');
  for (const d of ['wiki/meta', 'deliverables', '_inbox', 'raw/samples', 'raw/specs', 'raw/scripts', 'templates']) {
    assert.ok(t.extraDirs.includes(d), `missing extraDir: ${d}`);
  }
  // zone subdirs under wiki/ are created per-system by the agent, never scaffolded
  const wikiDirs = t.extraDirs.filter((d) => d.startsWith('wiki/'));
  assert.deepEqual(wikiDirs, ['wiki/meta'], `unexpected wiki/ zone dirs scaffolded: ${wikiDirs.join(', ')}`);
});

test('template[code-archaeology] seeds the five meta pages and four deliverable skeletons', () => {
  const t = getTemplate('code-archaeology');
  const paths = Object.keys(t.extraFiles);
  for (const f of ['glossary.md', 'ecosystem.md', 'project-status.md', 'open-threads.md', 'patterns.md']) {
    assert.ok(paths.includes(`wiki/meta/${f}`), `missing seeded meta page: ${f}`);
  }
  for (const f of ['DISCOVERY.md', 'ANALYSIS.md', 'DESIGN.md', 'NOTES.md']) {
    assert.ok(paths.includes(`templates/${f}`), `missing deliverable skeleton: ${f}`);
  }
  // every wiki/ extraFile lives under wiki/meta/ — grounding-exempt by isGroundable(),
  // so a fresh scaffold reads clean under `tng-wiki ground` / `rounds`
  for (const p of paths.filter((x) => x.startsWith('wiki/'))) {
    assert.ok(p.startsWith('wiki/meta/'), `groundable wiki page seeded outside wiki/meta/: ${p}`);
  }
  assert.equal(t.seedSource, null, 'code-archaeology ships no seed source — leads arrive via _inbox/');
});

test('template[code-archaeology] indexMd carries a Deliverables Shelf and none of the SE tables', () => {
  const out = getTemplate('code-archaeology').indexMd('Dig Site');
  assert.match(out, /## Deliverables Shelf/);
  for (const seSection of ['Decisions (ADRs)', 'Runbooks', 'Tech Debt', 'Incidents']) {
    assert.ok(!out.includes(seSection), `SE section table leaked into code-archaeology index: ${seSection}`);
  }
});

test('template[code-archaeology] NOTES skeleton carries the rejection log', () => {
  const notes = getTemplate('code-archaeology').extraFiles['templates/NOTES.md'];
  assert.match(notes, /## Rejection log/);
  assert.match(notes, /Why rejected/);
});
