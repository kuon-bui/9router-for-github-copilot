import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NineRouterError } from '@/router/errors';
import {
  NINE_ROUTER_CHAT_PARTICIPANT_ID,
  registerUsageChatParticipant
} from '@/runtime/chat-participant';
import { __resetUsagePanelForTests } from '@/runtime/usage-panel';
import {
  __createCancellationToken,
  __getChatParticipants,
  __getWebviewPanels,
  __resetVscodeState,
  Uri
} from '@test/support/vscode';
import { MOCK_USAGE_PAYLOAD } from '@test/support/usage-fixture';

describe('registerUsageChatParticipant', () => {
  beforeEach(() => {
    __resetVscodeState();
    __resetUsagePanelForTests();
  });

  it('registers @9router, opens the usage dashboard, and does not dump quota markdown', async () => {
    const showUsage = vi.fn(async () => MOCK_USAGE_PAYLOAD);
    const markdown: string[] = [];
    const progress: string[] = [];

    registerUsageChatParticipant({ subscriptions: [], extensionUri: Uri.file('/ext') }, { showUsage });

    const participants = __getChatParticipants();
    expect(participants).toHaveLength(1);
    expect(participants[0]?.id).toBe(NINE_ROUTER_CHAT_PARTICIPANT_ID);

    await participants[0]?.handler(
      { command: 'usage' },
      {},
      {
        progress: (message: string) => {
          progress.push(message);
        },
        markdown: (message: string) => {
          markdown.push(message);
        }
      },
      __createCancellationToken().value
    );

    expect(showUsage).toHaveBeenCalledTimes(1);
    expect(progress).toEqual(['Fetching 9router usage…']);
    expect(__getWebviewPanels()).toHaveLength(1);
    expect(__getWebviewPanels()[0]?.showOptions).toEqual({
      viewColumn: -2,
      preserveFocus: false
    });
    expect(__getWebviewPanels()[0]?.html).toContain('id="root"');
    expect(markdown).toEqual(['Opened the Usage dashboard.']);
    expect(markdown.join('\n')).not.toContain('## Usage');
    expect(markdown.join('\n')).not.toContain('Balance (USD)');
    expect(markdown.join('\n')).not.toContain('<img src="data:image/svg+xml,');
  });

  it('rejects unsupported freeform prompts', async () => {
    const showUsage = vi.fn();
    const markdown: string[] = [];

    registerUsageChatParticipant({ subscriptions: [], extensionUri: Uri.file('/ext') }, { showUsage });
    await __getChatParticipants()[0]?.handler(
      { command: undefined },
      {},
      {
        progress: () => undefined,
        markdown: (message: string) => {
          markdown.push(message);
        }
      },
      __createCancellationToken().value
    );

    expect(showUsage).not.toHaveBeenCalled();
    expect(markdown.join('\n')).toContain('only supports `/usage`');
  });

  it('surfaces typed usage failures in chat markdown', async () => {
    const markdown: string[] = [];

    registerUsageChatParticipant(
      { subscriptions: [], extensionUri: Uri.file('/ext') },
      {
        showUsage: async () => {
          throw new NineRouterError('AUTHENTICATION_ERROR', '9router API key is not configured', {
            requestId: 'req-chat-usage'
          });
        }
      }
    );

    await __getChatParticipants()[0]?.handler(
      { command: 'usage' },
      {},
      {
        progress: () => undefined,
        markdown: (message: string) => {
          markdown.push(message);
        }
      },
      __createCancellationToken().value
    );

    expect(markdown.join('\n')).toContain(
      '9router usage failed: 9router API key is not configured Request ID: req-chat-usage.'
    );
  });
});
