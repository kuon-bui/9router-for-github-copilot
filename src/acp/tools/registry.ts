import type { RouterToolDefinition } from '@/types/router-contract';
import type { AcpAgentMode } from '@/types/acp-agent-contract';

export function getAvailableTools(mode: AcpAgentMode): RouterToolDefinition[] {
  const tools: RouterToolDefinition[] = [
    {
      type: 'function',
      name: 'read_file',
      description: 'Read contents of a file with optional line range pagination.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to file within workspace' },
          offset: { type: 'integer', description: '1-based line number to begin reading from' },
          limit: { type: 'integer', description: 'Maximum number of lines to read (max 2000)' }
        },
        required: ['path']
      },
      strict: false
    },
    {
      type: 'function',
      name: 'list_directory',
      description: 'List contents of a directory recursively up to a specified depth.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to directory (defaults to .)' },
          depth: { type: 'integer', description: 'Recursion depth from 1 to 5 (default 2)' }
        }
      },
      strict: false
    },
    {
      type: 'function',
      name: 'search_files',
      description: 'Search for text or regular expressions across workspace files.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Text or regex to search for' },
          regex: { type: 'boolean', description: 'True if query is a regular expression' },
          glob: { type: 'string', description: 'Glob pattern filter (e.g. "**/*.ts")' },
          path: { type: 'string', description: 'Directory to search within' }
        },
        required: ['query']
      },
      strict: false
    },
    {
      type: 'function',
      name: 'update_plan',
      description: 'Update the user-visible task list and current progress.',
      parameters: {
        type: 'object',
        properties: {
          entries: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                content: { type: 'string', description: 'Description of the step' },
                status: {
                  type: 'string',
                  enum: ['pending', 'in_progress', 'completed', 'cancelled']
                },
                priority: {
                  type: 'string',
                  enum: ['low', 'medium', 'high']
                }
              },
              required: ['content', 'status']
            }
          }
        },
        required: ['entries']
      },
      strict: false
    }
  ];

  if (mode !== 'read-only') {
    tools.push(
      {
        type: 'function',
        name: 'edit_file',
        description: 'Replace an exact section of text in a file with new text.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to file to edit' },
            old_string: { type: 'string', description: 'Exact string to be replaced' },
            new_string: { type: 'string', description: 'Replacement content' },
            replace_all: { type: 'boolean', description: 'Replace all occurrences if true' }
          },
          required: ['path', 'old_string', 'new_string']
        },
        strict: false
      },
      {
        type: 'function',
        name: 'write_file',
        description: 'Create or overwrite a file with complete content.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to file to write' },
            content: { type: 'string', description: 'Complete content to write' }
          },
          required: ['path', 'content']
        },
        strict: false
      },
      {
        type: 'function',
        name: 'run_command',
        description: 'Run a shell command in the workspace directory.',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Shell command string to execute' },
            timeout_ms: { type: 'integer', description: 'Command timeout in milliseconds' }
          },
          required: ['command']
        },
        strict: false
      }
    );
  }

  return tools;
}
