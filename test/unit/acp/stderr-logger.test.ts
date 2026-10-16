import { describe, expect, it } from 'vitest';
import { createStderrLogger } from '@/acp/stderr-logger';

describe('createStderrLogger', () => {
  it('writes formatted logs to stderr with secret redaction', () => {
    const writes: string[] = [];
    const writer = (msg: string) => { writes.push(msg); };

    const logger = createStderrLogger('verbose', writer);
    logger.log('minimal', 'User sent token', { token: 'secret-token-value', normal: 'safe' });

    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('[9router-acp]');
    expect(writes[0]).toContain('[minimal] User sent token');
    expect(writes[0]).toContain('[REDACTED]');
    expect(writes[0]).not.toContain('secret-token-value');
    expect(writes[0]).toContain('"normal":"safe"');
  });

  it('filters messages below configured debug mode threshold', () => {
    const writes: string[] = [];
    const writer = (msg: string) => { writes.push(msg); };

    const logger = createStderrLogger('minimal', writer);
    logger.log('verbose', 'Verbose detail');
    logger.log('metadata', 'Metadata detail');
    expect(writes).toHaveLength(0);

    logger.log('minimal', 'Minimal info');
    expect(writes).toHaveLength(1);
  });

  it('redacts raw API keys in error messages', () => {
    const writes: string[] = [];
    const writer = (msg: string) => { writes.push(msg); };

    const logger = createStderrLogger('minimal', writer);
    logger.error('Failed request with Bearer sk-ant-api03-abcdef123456');

    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('[error]');
    expect(writes[0]).not.toContain('sk-ant-api03-abcdef123456');
  });
});
