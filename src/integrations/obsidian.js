import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/**
 * Attempts to detect an existing Obsidian vault location.
 * Returns the first vault path found, or null.
 */
export function detectObsidian() {
  const home = homedir();

  // Common Obsidian vault locations
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
      // Check if it's an Obsidian vault (has .obsidian dir) or a vault container
      if (existsSync(join(dir, '.obsidian'))) {
        return dir;
      }
      // Check if any subdirectory is a vault
      try {
        const subs = readdirSync(dir, { withFileTypes: true });
        for (const sub of subs) {
          if (sub.isDirectory() && existsSync(join(dir, sub.name, '.obsidian'))) {
            return dir; // Return the parent as the vault container
          }
        }
      } catch { /* permission errors, etc */ }
    }
  }

  return null;
}
