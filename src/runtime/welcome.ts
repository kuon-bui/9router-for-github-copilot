import * as vscode from 'vscode';
import { getApiKey } from '@/config/secret-store';

export const WELCOME_SHOWN_KEY = '9router-copilot.welcomeShown';

const SET_API_KEY_ACTION = 'Set API Key';

export async function showWelcomeIfNeeded(
  context: Pick<vscode.ExtensionContext, 'secrets' | 'globalState'>
): Promise<void> {
  if (context.globalState.get<boolean>(WELCOME_SHOWN_KEY) === true) {
    return;
  }

  if ((await getApiKey(context.secrets)) !== undefined) {
    return;
  }

  // Marked before showing, so a dismissed message also counts as seen.
  await context.globalState.update(WELCOME_SHOWN_KEY, true);
  const choice = await vscode.window.showInformationMessage(
    'Connect 9router to use its models in GitHub Copilot Chat.',
    SET_API_KEY_ACTION
  );
  if (choice === SET_API_KEY_ACTION) {
    await vscode.commands.executeCommand('9routerCopilot.setApiKey');
  }
}
