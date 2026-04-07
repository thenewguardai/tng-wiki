import { makeIndexMd, makeLogMd, today } from '../shared.js';

export const businessOpsTemplate = {
  extraDirs: [
    'raw/meetings',
    'raw/decisions',
    'raw/strategy',
    'raw/customer-calls',
    'wiki/projects',
    'wiki/decisions',
    'wiki/people',
    'wiki/processes',
    'wiki/retrospectives',
    'output/reports',
  ],

  indexMd: (wikiName) => makeIndexMd(wikiName, [
    { title: 'Projects', columns: ['Status', 'Owner', 'Updated'] },
    { title: 'Decisions', columns: ['Summary', 'Date', 'Outcome'] },
    { title: 'People', columns: ['Role', 'Key Context', 'Updated'] },
    { title: 'Processes', columns: ['Summary', 'Updated'] },
    { title: 'Retrospectives', columns: ['Date', 'Key Lessons'] },
  ]),

  logMd: makeLogMd,
  seedSource: null,
  extraFiles: {},
};
