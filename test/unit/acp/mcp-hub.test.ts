import { describe, expect, it } from 'vitest';
import { parseMcpToolName, sanitizeMcpToolName } from '@/acp/mcp/mcp-tool-names';
import { formatMcpToolResult } from '@/acp/mcp/mcp-result';

describe('mcp-tool-names', () => {
  it('formats server and tool names safely into mcp__<server>__<tool>', () => {
    const formatted = sanitizeMcpToolName('sqlite-db', 'query_users');
    expect(formatted).toBe('mcp__sqlite_db__query_users');
  });

  it('replaces special characters with underscores', () => {
    const formatted = sanitizeMcpToolName('my.server@v1', 'find-user:by-id');
    expect(formatted).toBe('mcp__my_server_v1__find_user_by_id');
  });

  it('truncates and hashes names exceeding 64 characters to guarantee uniqueness', () => {
    const longServer = 'a'.repeat(40);
    const longTool = 'b'.repeat(40);
    const formatted = sanitizeMcpToolName(longServer, longTool);

    expect(formatted.length).toBeLessThanOrEqual(64);
    expect(formatted.startsWith('mcp__')).toBe(true);

    const second = sanitizeMcpToolName(longServer, longTool + 'c');
    expect(second).not.toBe(formatted);
  });

  it('parses valid mcp tool names back into components', () => {
    const parsed = parseMcpToolName('mcp__github__search_repos');
    expect(parsed).toEqual({
      serverName: 'github',
      toolName: 'search_repos'
    });

    expect(parseMcpToolName('read_file')).toBeNull();
    expect(parseMcpToolName('not_mcp_format')).toBeNull();
  });
});

describe('mcp-result', () => {
  it('formats text contents into single output string', () => {
    const res = formatMcpToolResult({
      content: [
        { type: 'text', text: 'First block' },
        { type: 'text', text: 'Second block' }
      ]
    });

    expect(res.ok).toBe(true);
    expect(res.output).toBe('First block\n\nSecond block');
  });

  it('handles error results', () => {
    const res = formatMcpToolResult({
      isError: true,
      content: [{ type: 'text', text: 'Database connection failed' }]
    });

    expect(res.ok).toBe(false);
    expect(res.output).toContain('Database connection failed');
  });
});
