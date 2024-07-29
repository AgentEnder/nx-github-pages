import { exec as execCallback, ExecOptions } from 'child_process';

export async function exec(
  command: string,
  options: ExecOptions & { stdio?: 'inherit' | 'ignore' }
) {
  const { stdio, ...childProcessArgs } = options;
  return new Promise<string>((resolve, reject) => {
    const childProcess = execCallback(
      command,
      childProcessArgs,
      (error, stdout) => {
        if (error) {
          reject(error);
        } else {
          resolve(stdout);
        }
      }
    );

    if ((stdio ?? 'inherit') === 'inherit') {
      childProcess.stdout?.pipe(process.stdout);
      childProcess.stderr?.pipe(process.stderr);
    }
  });
}
