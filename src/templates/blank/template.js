import { makeIndexMd, makeLogMd } from '../shared.js';

export const blankTemplate = {
  extraDirs: [],

  indexMd: (wikiName) => makeIndexMd(wikiName, [
    { title: 'Topics', columns: ['Summary', 'Sources', 'Updated'] },
  ]),

  logMd: makeLogMd,
  seedSource: null,
  extraFiles: {},
};
