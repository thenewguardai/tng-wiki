export function makeIndexMd(wikiName, sections = []) {
  const sectionBlocks = sections.map(s => `## ${s.title}
| Page | ${s.columns.join(' | ')} |
|------|${s.columns.map(() => '------').join('|')}|
| _No pages compiled yet_ |${s.columns.map(() => ' ').join('|')}|
`).join('\n');

  return `# ${wikiName} — Index

_Last updated: ${today()} | Total pages: 0 | Total sources: 0_

> This index is maintained by the LLM. Read this file first when answering any query.

${sectionBlocks}`;
}

export function makeLogMd(wikiName, domain) {
  return `# Operations Log

> Append-only. Every operation gets an entry.
> Prefix: \`## [ISO-DATE] type | Description\`
> Grep: \`grep "^## \\[" log.md | tail -10\`

## [${new Date().toISOString().slice(0, 19)}] init | Wiki initialized
- Wiki: ${wikiName}
- Domain: ${domain}
- Scaffold: tng-wiki CLI
- Notes: Ready for first source ingest.
`;
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function frontmatter(fields) {
  const lines = Object.entries(fields).map(([k, v]) => {
    if (Array.isArray(v)) return `${k}: [${v.join(', ')}]`;
    return `${k}: ${typeof v === 'string' && v.includes(':') ? `"${v}"` : v}`;
  });
  return `---\n${lines.join('\n')}\n---\n`;
}
