import { spawn, SpawnOptions } from 'child_process';

export async function exec(
  command: string,
  options: Omit<SpawnOptions, 'shell' | 'stdio'> & {
    stdio?: 'inherit' | 'ignore';
  }
) {
  const { stdio, ...childProcessArgs } = options;
  return new Promise<string>((resolve, reject) => {
    const childProcess = spawn(command, {
      shell: true,
      ...childProcessArgs,
    });

    let stdout = '';
    if (childProcess.stdout) {
      childProcess.stdout.on('data', (data) => {
        stdout += data;
      });
    }

    if ((stdio ?? 'inherit') === 'inherit') {
      childProcess.stdout?.pipe(process.stdout);
      childProcess.stderr?.pipe(process.stderr);
    }

    childProcess.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(`Command failed with exit code ${code}: ${command}`)
        );
      } else {
        resolve(stdout);
      }
    });
  });
}
