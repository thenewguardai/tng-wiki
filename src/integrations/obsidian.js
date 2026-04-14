import { existsSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';

/**
 * Attempts to find a likely base directory for creating a new Obsidian-backed wiki.
 * If an existing vault is found, return its parent so the new wiki is created alongside it.
 */
export function detectObsidian(home = homedir()) {

  // Common Obsidian vault/container locations
  const candidates = [
    join(home, 'Documents', 'Obsidian'),
    join(home, 'Documents', 'obsidian'),
    join(home, 'Obsidian'),
    join(home, 'obsidian'),
    join(home, 'Documents', 'Vault'),
    join(home, 'Documents', 'vault'),
    join(home, 'Documents', 'Notes'),
    join(home, 'Documents', 'notes'),
  ];

  for (const dir of candidates) {
    if (existsSync(dir)) {
      // Existing vault: return its parent so a new wiki becomes a sibling vault.
      if (existsSync(join(dir, '.obsidian'))) {
        return dirname(dir);
      }

      // Vault container: return the container directory itself.
      try {
        const subs = readdirSync(dir, { withFileTypes: true });
        for (const sub of subs) {
          if (sub.isDirectory() && existsSync(join(dir, sub.name, '.obsidian'))) {
            return dir;
          }
        }
      } catch { /* permission errors, etc */ }
    }
  }

  return null;
}
