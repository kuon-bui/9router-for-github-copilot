import type { ConfiguredModel } from '@/types/product-model';
import type { RouterToolDefinition } from '@/types/router-contract';
import { canonicalizeJsonObject } from './canonical-json';

export interface HostToolDefinition {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface RejectedToolDefinition {
  name: string;
  code: 'MODEL_TOOLS_DISABLED' | 'INVALID_TOOL_NAME' | 'INVALID_TOOL_SCHEMA';
  message: string;
}

export interface RouterToolOptions {
  definitions: RouterToolDefinition[];
  toolChoice?: 'auto' | 'required';
  rejectedTools: RejectedToolDefinition[];
}

export function shouldExposeTools(setting: ConfiguredModel): boolean {
  return setting.toolMode === 'auto';
}

export function adaptToolsToRouterDefinitions(
  tools: readonly HostToolDefinition[]
): RouterToolDefinition[] {
  return [...tools]
    .sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0
    )
    .map((tool) => {
      const definition: RouterToolDefinition = {
        type: 'function',
        name: tool.name,
        parameters: normalizeToolSchema(tool.inputSchema),
        strict: false
      };

      if (tool.description) {
        definition.description = tool.description;
      }

      return definition;
    });
}

export function adaptToolOptionsForRouter(input: {
  selectedModel: ConfiguredModel;
  tools?: readonly HostToolDefinition[];
  hostToolMode?: unknown;
}): RouterToolOptions {
  const tools = input.tools ?? [];

  if (tools.length === 0) {
    return {
      definitions: [],
      rejectedTools: []
    };
  }

  if (!shouldExposeTools(input.selectedModel)) {
    return {
      definitions: [],
      rejectedTools: tools.map((tool) => ({
        name: typeof tool.name === 'string' ? tool.name : '[unknown]',
        code: 'MODEL_TOOLS_DISABLED',
        message: `Display model "${input.selectedModel.id}" does not expose tools.`
      }))
    };
  }

  const acceptedTools: HostToolDefinition[] = [];
  const rejectedTools: RejectedToolDefinition[] = [];

  for (const tool of tools) {
    const name = typeof tool.name === 'string' ? tool.name.trim() : '';
    if (name.length === 0) {
      rejectedTools.push({
        name: '[unknown]',
        code: 'INVALID_TOOL_NAME',
        message: 'Tool name must be a non-empty string.'
      });
      continue;
    }

    if (tool.inputSchema !== undefined && !isPlainObject(tool.inputSchema)) {
      rejectedTools.push({
        name,
        code: 'INVALID_TOOL_SCHEMA',
        message: `Tool "${name}" has an invalid input schema.`
      });
      continue;
    }

    const acceptedTool: HostToolDefinition = {
      name
    };

    if (tool.description) {
      acceptedTool.description = tool.description;
    }

    if (tool.inputSchema !== undefined) {
      acceptedTool.inputSchema = tool.inputSchema;
    }

    acceptedTools.push(acceptedTool);
  }

  const definitions = adaptToolsToRouterDefinitions(acceptedTools);
  const result: RouterToolOptions = {
    definitions,
    rejectedTools
  };

  if (definitions.length > 0) {
    result.toolChoice = mapHostToolMode(input.hostToolMode);
  }

  return result;
}

function normalizeToolSchema(input: unknown): Record<string, unknown> {
  if (isPlainObject(input)) {
    return canonicalizeJsonObject(input);
  }

  return {
    type: 'object',
    properties: {}
  };
}

function isPlainObject(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function mapHostToolMode(hostToolMode: unknown): 'auto' | 'required' {
  return hostToolMode === 2 ? 'required' : 'auto';
}
