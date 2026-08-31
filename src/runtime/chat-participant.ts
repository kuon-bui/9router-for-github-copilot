import * as vscode from 'vscode';
import { NineRouterError } from '@/router/errors';
import { showUsagePanel } from './usage-panel';
import type { UsageReporter } from './show-usage';

export const NINE_ROUTER_CHAT_PARTICIPANT_ID = '9router-copilot.9router';

export function registerUsageChatParticipant(
  context: Pick<vscode.ExtensionContext, 'subscriptions' | 'extensionUri'>,
  dependencies: {
    showUsage?: UsageReporter;
  }
): void {
  const participant = vscode.chat.createChatParticipant(
    NINE_ROUTER_CHAT_PARTICIPANT_ID,
    async (request, _context, stream, token) => {
      if (request.command !== 'usage') {
        stream.markdown(
          'This participant only supports `/usage`. Try `@9router /usage` to show connection quotas.'
        );
        return {};
      }

      if (!dependencies.showUsage) {
        stream.markdown('9router usage reporting is unavailable in this session.');
        return {};
      }

      stream.progress('Fetching 9router usage…');
      try {
        const snapshot = await dependencies.showUsage(token);
        await showUsagePanel(context.extensionUri, snapshot, { viewColumn: vscode.ViewColumn.Beside });
        stream.markdown('Opened the Usage dashboard.');
      } catch (error) {
        const requestId = error instanceof NineRouterError ? error.requestId : undefined;
        const message =
          error instanceof NineRouterError ? error.message : 'Unexpected usage error';
        stream.markdown(
          `9router usage failed: ${message}${requestId ? ` Request ID: ${requestId}.` : ''}`
        );
      }

      return {};
    }
  );

  participant.iconPath = new vscode.ThemeIcon('dashboard');
  context.subscriptions.push(participant);
}
