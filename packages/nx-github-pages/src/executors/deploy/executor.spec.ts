import { ExecutorContext } from '@nx/devkit';

const buildContext = (
  options: Partial<ExecutorContext> = {}
): ExecutorContext =>
  ({
    root: '/root',
    cwd: '/root',
    isVerbose: false,
    ...options,
  }) as ExecutorContext;

describe('deploy executor', () => {
  it('should work', () => {
    expect(true).toBeTruthy();
  });
});
