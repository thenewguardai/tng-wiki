import { execSync } from 'child_process';

export async function setupGit(root) {
  try {
    execSync('git init', { cwd: root, stdio: 'pipe' });
    execSync('git add -A', { cwd: root, stdio: 'pipe' });
    execSync('git commit -m "init: scaffold wiki with tng-wiki"', {
      cwd: root,
      stdio: 'pipe',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || 'tng-wiki',
        GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || 'wiki@localhost',
        GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME || 'tng-wiki',
        GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL || 'wiki@localhost',
      },
    });
    return { attempted: true, success: true };
  } catch (err) {
    return { attempted: true, success: false, error: err.message };
  }
}
