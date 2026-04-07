import { makeIndexMd, makeLogMd, today } from '../shared.js';

export const learningTemplate = {
  extraDirs: [
    'raw/books',
    'raw/courses',
    'raw/lectures',
    'wiki/concepts',
    'wiki/people',
    'wiki/connections',
    'wiki/questions',
    'output/summaries',
    'output/flashcards',
  ],

  indexMd: (wikiName) => makeIndexMd(wikiName, [
    { title: 'Concepts', columns: ['Summary', 'Sources', 'Confidence', 'Updated'] },
    { title: 'People', columns: ['Field', 'Key Contributions', 'Updated'] },
    { title: 'Connections', columns: ['Links', 'Insight', 'Updated'] },
    { title: 'Open Questions', columns: ['Summary', 'Priority', 'Updated'] },
    { title: 'Sources', columns: ['Type', 'Status', 'Updated'] },
  ]),

  logMd: makeLogMd,
  seedSource: null,
  extraFiles: {},
};
