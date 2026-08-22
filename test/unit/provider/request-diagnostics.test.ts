import { describe, expect, it } from 'vitest';
import { createRouterRequestDiagnostics } from '@/provider/request-diagnostics';

describe('createRouterRequestDiagnostics', () => {
  it('reports request shape without retaining message or image content', () => {
    const diagnostics = createRouterRequestDiagnostics({
      model: 'combo/daily',
      stream: true,
      store: false,
      input: [
        { role: 'system', content: 'sensitive-system-prompt' },
        {
          role: 'user',
          content: [
            { type: 'input_text', text: 'sensitive-user-prompt' },
            { type: 'input_image', image_url: 'data:image/png;base64,sensitive-image' }
          ]
        },
        { role: 'assistant', content: 'calling a tool' },
        {
          type: 'function_call',
          call_id: 'call-1',
          name: 'lookup',
          arguments: '{"secret":true}'
        },
        { type: 'function_call_output', call_id: 'call-1', output: 'sensitive-result' }
      ],
      reasoning: { effort: 'high', summary: 'auto' },
      max_output_tokens: 8_192,
      tools: [{ type: 'function', name: 'lookup', parameters: {} }],
      tool_choice: 'auto'
    });

    expect(diagnostics).toEqual({
      assistantMessageCount: 1,
      functionCallCount: 1,
      functionCallOutputCount: 1,
      hasReasoning: true,
      imagePartCount: 1,
      inputItemCount: 5,
      maxOutputTokens: 8_192,
      systemMessageCount: 1,
      textPartCount: 3,
      toolChoice: 'auto',
      toolDefinitionCount: 1,
      userMessageCount: 1
    });
    expect(JSON.stringify(diagnostics)).not.toContain('sensitive');
  });
});
