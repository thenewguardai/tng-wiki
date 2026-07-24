// Cross-wiki wikilinks (#43): `[[<wiki-slug>:page]]`, resolvable through the
// LOCAL registry. The slug travels inside committed content, so it is only as
// portable as slug naming is consistent across machines - registering via the
// wiki's manifest name (the default, and what monorepo register does) keeps
// them aligned. Registry-only imports here: ground.js and verbs-cli.js both
// consume this module, so it must not import either.
import { loadRegistry, getWiki } from './registry.js';

// A qualified link body: slug ':' page. Slugs are slugifyName() output
// ([a-z0-9-]), so a colon after that alphabet is unambiguous - page names in
// practice never contain colons, and plain [[page]] links never match.
export const CROSS_WIKI_LINK_RE = /\[\[([a-z0-9][a-z0-9-]*):([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;

// Parse `slug:page` / `[[slug:page]]` input (as typed at a CLI or in a page).
// Returns { slug, page } or null when the input is not a qualified reference.
export function parseCrossRef(input) {
  let cleaned = String(input).trim();
  const wrapped = cleaned.match(/^\[\[([^\]]+)\]\]$/);
  if (wrapped) cleaned = wrapped[1].split(/[|#]/)[0].trim();
  const m = cleaned.match(/^([a-z0-9][a-z0-9-]*):(.+)$/);
  return m ? { slug: m[1], page: m[2].trim() } : null;
}

// Registry lookup for a qualified reference's wiki. Returns the wiki entry or
// null when the slug is not registered on this machine.
export function crossRefWiki(slug, home) {
  return getWiki(loadRegistry(home), slug);
}

// Every qualified link in a page body: [{ slug, page, line }]. Fenced code
// blocks and inline code spans are skipped - syntax examples are not links.
export function extractCrossWikiLinks(body, bodyStartLine = 1) {
  const links = [];
  const lines = body.split('\n');
  let fenced = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) { fenced = !fenced; continue; }
    if (fenced) continue;
    const text = lines[i].replace(/`[^`]*`/g, '');
    for (const m of text.matchAll(CROSS_WIKI_LINK_RE)) {
      links.push({ slug: m[1], page: m[2].trim(), line: i + bodyStartLine });
    }
  }
  return links;
}
