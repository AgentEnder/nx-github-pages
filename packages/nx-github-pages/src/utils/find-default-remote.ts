import { exec } from './exec';

export async function findDefaultRemote(
  directory: string
): Promise<string | undefined> {
  const lines = (await exec('git remote -v', { cwd: directory })).split('\n');
  const pushRemotes: string[] = [];
  for (const line of lines) {
    const [remoteName, url, type] = line.split(/\s+/).map((s) => s.trim());
    if (type === '(push)') {
      if (remoteName === 'origin') {
        return url;
      } else {
        pushRemotes.push(`${remoteName} (${url})`);
      }
    }
  }
}
