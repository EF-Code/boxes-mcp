import { describe, it, expect } from 'vitest';
import { sh } from './exec.js';

describe('exec.sh() - Integration Tests', () => {
  it('should execute command successfully and return stdout', async () => {
    const result = await sh('echo', ['hello']);

    expect(result.stdout).toContain('hello');
    expect(result.stderr).toBe('');
  });

  it('should capture stderr from commands', async () => {
    // Use a command that writes to stderr
    const result = await sh('node', ['-e', 'console.error("error message")']);

    expect(result.stderr).toContain('error message');
  });

  it('should handle command execution errors', async () => {
    await expect(
      sh('nonexistent-command-12345', [])
    ).rejects.toThrow();
  });

  it('should execute commands with arguments', async () => {
    const result = await sh('echo', ['arg1', 'arg2']);

    expect(result.stdout).toContain('arg1');
    expect(result.stdout).toContain('arg2');
  });

  it('should respect timeout settings', async () => {
    // Test that a long-running command can be timed out
    // Using a sleep command that will be killed by timeout
    await expect(
      sh('sleep', ['10'], { timeoutMs: 100 })
    ).rejects.toThrow();
  }, 10000); // Give the test itself 10 seconds to complete
});
