import { execFileSync } from 'child_process';
import { join } from 'path';

export function slugifyWikiName(wikiName) {
  return wikiName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export async function setupQmd(root, wikiName, deps = {}) {
  // execFileSync with an argument array, never a shell string: wikiDir and
  // wikiName are user-controlled at init time and may contain spaces, quotes,
  // or shell metacharacters. Same discipline as git-read.js.
  const { exec = (file, args) => execFileSync(file, args, { stdio: 'pipe' }) } = deps;

  const slug = slugifyWikiName(wikiName);
  const wikiDir = join(root, 'wiki');

  try {
    exec('qmd', ['--version']);
  } catch {
    return { installed: false, configured: false, slug, wikiDir };
  }

  try {
    exec('qmd', ['collection', 'add', wikiDir, '--name', slug, '--mask', '**/*.md']);
    exec('qmd', ['context', 'add', `qmd://${slug}`, `LLM-maintained wiki: ${wikiName}`]);
    return { installed: true, configured: true, slug, wikiDir };
  } catch (err) {
    return {
      installed: true,
      configured: false,
      error: err.message,
      slug,
      wikiDir,
    };
  }
}
