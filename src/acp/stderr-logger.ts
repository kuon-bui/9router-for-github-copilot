import { shouldLogDebug } from '@/debug/debug-level';
import { redactObject, redactSensitiveText } from '@/debug/redaction';
import type { DebugMode } from '@/debug/debug-level';

export interface StderrLogger {
  log(level: DebugMode, message: string, metadata?: Record<string, unknown>): void;
  error(message: string, error?: unknown): void;
  warn(message: string): void;
  info(message: string): void;
}

export type StderrWriter = (message: string) => void;

function defaultStderrWriter(message: string): void {
  process.stderr.write(`${message}\n`);
}

export function createStderrLogger(
  configuredLevel: DebugMode = 'minimal',
  writer: StderrWriter = defaultStderrWriter
): StderrLogger {
  function writeLine(tag: string, message: string, metadata?: Record<string, unknown>): void {
    const safeMessage = redactSensitiveText(message);
    const safeMetadata = metadata ? ` ${JSON.stringify(redactObject(metadata))}` : '';
    writer(`[9router-acp] [${tag}] ${safeMessage}${safeMetadata}`);
  }

  return {
    log(level: DebugMode, message: string, metadata?: Record<string, unknown>): void {
      if (!shouldLogDebug(configuredLevel, level)) {
        return;
      }
      writeLine(level, message, metadata);
    },

    error(message: string, error?: unknown): void {
      const errorMsg = error instanceof Error ? `: ${error.message}` : '';
      writeLine('error', `${message}${errorMsg}`);
    },

    warn(message: string): void {
      writeLine('warn', message);
    },

    info(message: string): void {
      writeLine('info', message);
    }
  };
}
