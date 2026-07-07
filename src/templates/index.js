import { aiResearchTemplate } from './ai-research/template.js';
import { competitiveIntelTemplate } from './competitive-intel/template.js';
import { publicationTemplate } from './publication/template.js';
import { businessOpsTemplate } from './business-ops/template.js';
import { learningTemplate } from './learning/template.js';
import { softwareEngineeringTemplate } from './software-engineering/template.js';
import { codeArchaeologyTemplate } from './code-archaeology/template.js';
import { blankTemplate } from './blank/template.js';

const templates = {
  'ai-research': aiResearchTemplate,
  'competitive-intel': competitiveIntelTemplate,
  'publication': publicationTemplate,
  'business-ops': businessOpsTemplate,
  'learning': learningTemplate,
  'software-engineering': softwareEngineeringTemplate,
  'code-archaeology': codeArchaeologyTemplate,
  'blank': blankTemplate,
};

// Canonical list of domain keys - the single source callers validate against
// (getTemplate falls back to blank silently, which is right for internal reads
// but wrong for user-typed --domain flags).
export const DOMAIN_KEYS = Object.keys(templates);

export function getTemplate(domain) {
  return templates[domain] || templates['blank'];
}
