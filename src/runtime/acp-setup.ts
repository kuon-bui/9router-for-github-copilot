import * as vscode from 'vscode';
import { generateAcpSnippet } from './acp-client-snippets';
import type { AcpSnippetTarget } from './acp-client-snippets';

export interface SetupAcpAgentDependencies {
  secretStore: { getApiKey: () => Promise<string | undefined> };
  settings: {
    baseUrl: string;
    models: Array<{ id: string; name: string; modelId: string }>;
  };
  version?: string | undefined;
}

interface TargetItem extends vscode.QuickPickItem {
  target: AcpSnippetTarget;
}

interface ModelItem extends vscode.QuickPickItem {
  modelId?: string | undefined;
}

interface KeyChoiceItem extends vscode.QuickPickItem {
  useRealKey: boolean;
}

export async function setupAcpAgent(deps: SetupAcpAgentDependencies): Promise<void> {
  const version = deps.version ?? '0.15.0';

  // 1. Pick target client
  const targetItems: TargetItem[] = [
    {
      label: 'Zed',
      description: 'Zed settings.json (agent_servers)',
      target: 'zed'
    },
    {
      label: 'JetBrains IDEs',
      description: '~/.jetbrains/acp.json (agent_servers)',
      target: 'jetbrains'
    },
    {
      label: 'VS Code ACP Client',
      description: 'settings.json (acp.agents)',
      target: 'vscode'
    }
  ];

  const targetSelection = await vscode.window.showQuickPick(targetItems, {
    placeHolder: 'Select target editor or ACP client'
  });

  if (!targetSelection) {
    return;
  }

  // 2. Pick default model
  const modelItems: ModelItem[] = deps.settings.models.map((m) => ({
    label: m.name,
    description: m.modelId,
    modelId: m.modelId
  }));

  modelItems.push({
    label: '(No default model)',
    description: 'Use the first model reported by 9router at runtime',
    modelId: undefined
  });

  const modelSelection = await vscode.window.showQuickPick(modelItems, {
    placeHolder: 'Select default model for ACP agent'
  });

  if (!modelSelection) {
    return;
  }

  // 3. Pick API key handling
  const keyChoiceItems: KeyChoiceItem[] = [
    {
      label: 'Placeholder (Recommended)',
      description: 'Use <your-9router-api-key>; safe to share or commit',
      useRealKey: false
    },
    {
      label: 'Include Current API Key',
      description: 'Inserts your active API key; copied strictly to clipboard',
      useRealKey: true
    }
  ];

  const keyChoiceSelection = await vscode.window.showQuickPick(keyChoiceItems, {
    placeHolder: 'Choose API key format'
  });

  if (!keyChoiceSelection) {
    return;
  }

  let apiKey = '<your-9router-api-key>';

  if (keyChoiceSelection.useRealKey) {
    const realKey = await deps.secretStore.getApiKey();
    if (!realKey) {
      await vscode.window.showErrorMessage(
        'No 9router API key is stored. Run "9router: Set API Key" first or select placeholder.'
      );
      return;
    }

    const warningAction = await vscode.window.showWarningMessage(
      'The configuration snippet containing your 9router API key will be copied to your clipboard. Never share this snippet or commit it to version control.',
      { modal: true },
      'Copy to Clipboard'
    );

    if (warningAction !== 'Copy to Clipboard') {
      return;
    }

    apiKey = realKey;
  }

  const snippet = generateAcpSnippet({
    target: targetSelection.target,
    version,
    baseUrl: deps.settings.baseUrl,
    modelId: modelSelection.modelId,
    apiKey
  });

  await vscode.env.clipboard.writeText(snippet);

  if (keyChoiceSelection.useRealKey) {
    await vscode.window.showInformationMessage(
      '9router ACP configuration snippet copied to clipboard.'
    );
  } else {
    await vscode.workspace.openTextDocument({
      content: snippet,
      language: 'json'
    });
    await vscode.window.showInformationMessage(
      '9router ACP configuration snippet copied to clipboard and opened in editor.'
    );
  }
}
