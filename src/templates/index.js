import { aiResearchTemplate } from './ai-research/template.js';
import { competitiveIntelTemplate } from './competitive-intel/template.js';
import { publicationTemplate } from './publication/template.js';
import { businessOpsTemplate } from './business-ops/template.js';
import { learningTemplate } from './learning/template.js';
import { blankTemplate } from './blank/template.js';

const templates = {
  'ai-research': aiResearchTemplate,
  'competitive-intel': competitiveIntelTemplate,
  'publication': publicationTemplate,
  'business-ops': businessOpsTemplate,
  'learning': learningTemplate,
  'blank': blankTemplate,
};

export function getTemplate(domain) {
  return templates[domain] || templates['blank'];
}
