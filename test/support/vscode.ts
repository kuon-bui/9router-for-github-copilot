class Disposable {
  private readonly disposeFn: (() => void) | undefined;

  public constructor(disposeFn?: () => void) {
    this.disposeFn = disposeFn;
  }

  public dispose(): void {
    this.disposeFn?.();
  }
}

class EventEmitter<T> {
  private readonly listeners = new Set<(value: T) => void>();

  public readonly event = (listener: (value: T) => void): Disposable => {
    this.listeners.add(listener);
    return new Disposable(() => {
      this.listeners.delete(listener);
    });
  };

  public fire(value: T): void {
    for (const listener of this.listeners) {
      listener(value);
    }
  }

  public dispose(): void {
    this.listeners.clear();
  }
}

class LanguageModelTextPart {
  public readonly value: string;

  public constructor(value: string) {
    this.value = value;
  }
}

class LanguageModelToolCallPart {
  public readonly callId: string;
  public readonly name: string;
  public readonly input: object;

  public constructor(callId: string, name: string, input: object) {
    this.callId = callId;
    this.name = name;
    this.input = input;
  }
}

class LanguageModelToolResultPart {
  public readonly callId: string;
  public readonly content: unknown[];

  public constructor(callId: string, content: unknown[]) {
    this.callId = callId;
    this.content = content;
  }
}

class LanguageModelDataPart {
  public readonly data: Uint8Array;
  public readonly mimeType: string;

  public constructor(data: Uint8Array, mimeType: string) {
    this.data = data;
    this.mimeType = mimeType;
  }
}

class LanguageModelThinkingPart {
  public readonly value: string | string[];
  public readonly id: string | undefined;
  public readonly metadata: Readonly<Record<string, unknown>> | undefined;

  public constructor(
    value: string | string[],
    id?: string,
    metadata?: Readonly<Record<string, unknown>>
  ) {
    this.value = value;
    this.id = id;
    this.metadata = metadata;
  }
}

class LanguageModelError extends Error {
  public readonly code: string;

  public constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = 'LanguageModelError';
    this.code = code;
  }

  public static NoPermissions(message?: string): LanguageModelError {
    return new LanguageModelError('NoPermissions', message);
  }

  public static Blocked(message?: string): LanguageModelError {
    return new LanguageModelError('Blocked', message);
  }

  public static NotFound(message?: string): LanguageModelError {
    return new LanguageModelError('NotFound', message);
  }
}

class ThemeIcon {
  public readonly id: string;

  public constructor(id: string) {
    this.id = id;
  }
}

class OutputChannel {
  public readonly lines: string[] = [];

  public appendLine(value: string): void {
    this.lines.push(value);
  }

  public show(): void {}

  public dispose(): void {
    this.lines.length = 0;
  }
}

class WebviewPanel {
  public readonly webview = {
    html: ''
  };
  public readonly onDidDispose = (listener: () => void): Disposable => {
    this.disposeListeners.add(listener);
    return new Disposable(() => {
      this.disposeListeners.delete(listener);
    });
  };
  private readonly disposeListeners = new Set<() => void>();
  public lastReveal: { viewColumn: unknown; preserveFocus: boolean } | undefined;
  public readonly showOptions: unknown;

  public constructor(
    public readonly viewType: string,
    public readonly title: string,
    showOptions: unknown = undefined
  ) {
    this.showOptions = showOptions;
  }

  public reveal(viewColumn?: unknown, preserveFocus?: boolean): void {
    this.lastReveal = {
      viewColumn,
      preserveFocus: preserveFocus === true
    };
  }

  public dispose(): void {
    for (const listener of this.disposeListeners) {
      listener();
    }
    this.disposeListeners.clear();
  }
}

const configurationValues = new Map<string, unknown>();
const commandHandlers = new Map<string, (...args: unknown[]) => unknown>();
let registeredProvider: unknown;
let inputBoxValue: string | undefined;
const outputChannel = new OutputChannel();
let quickPickValues: unknown[] = [];
let selectedChatModels: unknown[] = [];
const configurationUpdates: Array<{ key: string; value: unknown; target: unknown }> = [];
const informationMessages: string[] = [];
const errorMessages: string[] = [];
const chatParticipants: Array<{
  id: string;
  handler: (...args: unknown[]) => unknown;
  iconPath?: unknown;
}> = [];
const webviewPanels: WebviewPanel[] = [];

export const ConfigurationTarget = { Global: 1 } as const;
export const ViewColumn = { Active: -1, Beside: -2 } as const;

export class LanguageModelChatMessage {
  public static User(content: unknown[]): LanguageModelChatMessage {
    return new LanguageModelChatMessage(1, content);
  }

  public constructor(
    public readonly role: number,
    public readonly content: unknown[]
  ) {}
}

export class CancellationTokenSource {
  private readonly state = __createCancellationToken();
  public readonly token = this.state.value;

  public cancel(): void {
    this.state.cancel();
  }

  public dispose(): void {}
}

export const commands = {
  registerCommand(command: string, handler: (...args: unknown[]) => unknown): Disposable {
    commandHandlers.set(command, handler);
    return new Disposable(() => {
      commandHandlers.delete(command);
    });
  }
};

export const window = {
  createOutputChannel(): OutputChannel {
    return outputChannel;
  },
  createWebviewPanel(
    viewType: string,
    title: string,
    showOptions: unknown,
    _options?: unknown
  ): WebviewPanel {
    void _options;
    const panel = new WebviewPanel(viewType, title, showOptions);
    webviewPanels.push(panel);
    return panel;
  },
  async showInputBox(): Promise<string | undefined> {
    return inputBoxValue;
  },
  async showQuickPick(): Promise<unknown> {
    return quickPickValues.shift();
  },
  async showInformationMessage(message: string): Promise<string | undefined> {
    informationMessages.push(message);
    return undefined;
  },
  async showErrorMessage(message: string): Promise<string | undefined> {
    errorMessages.push(message);
    return undefined;
  }
};

export const workspace = {
  getConfiguration(): {
    get: <T>(key: string) => T | undefined;
    update: (key: string, value: unknown, target: unknown) => Promise<void>;
  } {
    return {
      get<T>(key: string): T | undefined {
        return configurationValues.get(key) as T | undefined;
      },
      async update(key: string, value: unknown, target: unknown): Promise<void> {
        configurationValues.set(key, value);
        configurationUpdates.push({ key, value, target });
      }
    };
  },
  onDidChangeConfiguration(listener: (event: { affectsConfiguration: (section: string) => boolean }) => void): Disposable {
    void listener;
    return new Disposable();
  }
};

export const extensions = {
  getExtension(): { activate: () => Promise<void> } | undefined {
    return undefined;
  }
};

export const lm = {
  registerLanguageModelChatProvider(_vendor: string, provider: unknown): Disposable {
    registeredProvider = provider;
    return new Disposable();
  },
  async selectChatModels(): Promise<unknown[]> {
    return selectedChatModels;
  }
};

export const chat = {
  createChatParticipant(
    id: string,
    handler: (...args: unknown[]) => unknown
  ): { iconPath?: unknown } & Disposable {
    const participant = {
      id,
      handler,
      iconPath: undefined as unknown,
      dispose(): void {
        const index = chatParticipants.findIndex((entry) => entry.id === id);
        if (index >= 0) {
          chatParticipants.splice(index, 1);
        }
      }
    };
    chatParticipants.push(participant);
    return participant;
  }
};

export function __setConfigurationValues(values: Record<string, unknown>): void {
  configurationValues.clear();
  for (const [key, value] of Object.entries(values)) {
    configurationValues.set(key, value);
  }
}

export function __setInputBoxValue(value: string | undefined): void {
  inputBoxValue = value;
}

export function __setQuickPickValues(values: unknown[]): void {
  quickPickValues = [...values];
}

export function __setSelectedChatModels(models: unknown[]): void {
  selectedChatModels = [...models];
}

export function __getConfigurationUpdates(): Array<{
  key: string;
  value: unknown;
  target: unknown;
}> {
  return [...configurationUpdates];
}

export function __getOutputLines(): string[] {
  return [...outputChannel.lines];
}

export function __getInformationMessages(): string[] {
  return [...informationMessages];
}

export function __getErrorMessages(): string[] {
  return [...errorMessages];
}

export function __getWebviewPanels(): Array<{
  viewType: string;
  title: string;
  html: string;
  showOptions: unknown;
  lastReveal: { viewColumn: unknown; preserveFocus: boolean } | undefined;
}> {
  return webviewPanels.map((panel) => ({
    viewType: panel.viewType,
    title: panel.title,
    html: panel.webview.html,
    showOptions: panel.showOptions,
    lastReveal: panel.lastReveal
  }));
}

export function __getRegisteredProvider(): unknown {
  return registeredProvider;
}

export function __getChatParticipants(): Array<{
  id: string;
  handler: (...args: unknown[]) => unknown;
  iconPath?: unknown;
}> {
  return [...chatParticipants];
}

export function __getCommandHandler(command: string): ((...args: unknown[]) => unknown) | undefined {
  return commandHandlers.get(command);
}

export function __createCancellationToken(): {
  value: { isCancellationRequested: boolean; onCancellationRequested: (listener: () => void) => Disposable };
  cancel: () => void;
} {
  let isCancellationRequested = false;
  const emitter = new EventEmitter<void>();

  return {
    value: {
      get isCancellationRequested() {
        return isCancellationRequested;
      },
      onCancellationRequested: emitter.event
    },
    cancel: () => {
      isCancellationRequested = true;
      emitter.fire();
    }
  };
}

export function __resetVscodeState(): void {
  configurationValues.clear();
  commandHandlers.clear();
  registeredProvider = undefined;
  inputBoxValue = undefined;
  outputChannel.lines.length = 0;
  quickPickValues = [];
  selectedChatModels = [];
  configurationUpdates.length = 0;
  informationMessages.length = 0;
  errorMessages.length = 0;
  chatParticipants.length = 0;
  for (const panel of webviewPanels) {
    panel.dispose();
  }
  webviewPanels.length = 0;
}

export {
  Disposable,
  EventEmitter,
  LanguageModelError,
  LanguageModelTextPart,
  LanguageModelThinkingPart,
  LanguageModelDataPart,
  LanguageModelToolCallPart,
  LanguageModelToolResultPart,
  ThemeIcon
};
