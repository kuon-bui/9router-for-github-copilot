import type * as vscode from 'vscode';

const API_KEY_SECRET = '9router.apiKey';

export async function getApiKey(secrets: vscode.SecretStorage): Promise<string | undefined> {
  return secrets.get(API_KEY_SECRET);
}

export async function setApiKey(secrets: vscode.SecretStorage, value: string): Promise<void> {
  await secrets.store(API_KEY_SECRET, value.trim());
}

export async function clearApiKey(secrets: vscode.SecretStorage): Promise<void> {
  await secrets.delete(API_KEY_SECRET);
}
