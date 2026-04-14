import { execSync } from 'child_process';
import { join } from 'path';

export async function setupQmd(root, wikiName) {
  const slug = wikiName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const wikiDir = join(root, 'wiki');

  // Check if qmd is installed
  try {
    execSync('qmd --version', { stdio: 'pipe' });
  } catch {
    return { installed: false, configured: false, slug, wikiDir };
  }

  // Register wiki as a QMD collection
  try {
    execSync(`qmd collection add "${wikiDir}" --name "${slug}" --mask "**/*.md"`, {
      stdio: 'pipe',
    });

    // Add context
    execSync(`qmd context add qmd://${slug} "LLM-maintained wiki: ${wikiName}"`, {
      stdio: 'pipe',
    });

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
