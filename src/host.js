// This machine's identity for committed host fields (`sharing: host:<name>`,
// `librarian: <name>`). Hostnames come back in whatever case the OS keeps
// (`Legion-Ubuntu`, `LEGION5090`) while people type them lowercase, so every
// comparison is case-insensitive. TNG_WIKI_HOST overrides the OS name for
// machines whose hostname is unstable or unhelpful (and for tests).
import { hostname } from 'os';

export function localHost() {
  const override = process.env.TNG_WIKI_HOST?.trim();
  return override || hostname();
}

export function sameHost(a, b) {
  if (!a || !b) return false;
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}
