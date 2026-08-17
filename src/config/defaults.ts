export const DEFAULT_BASE_URL = 'http://127.0.0.1:3456/v1';
export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
export const DEFAULT_MAX_TOKENS = 0;
export const DEFAULT_DEBUG_MODE = 'minimal' as const;
export const DEFAULT_MODEL_TOOL_MODE = 'off' as const;
export const DEFAULT_MODEL_VISION_MODE = 'off' as const;
export const DEFAULT_MODEL_THINKING_MODE = 'off' as const;
export const DEFAULT_MODEL_MAX_INPUT_TOKENS = 264_000;
export const DEFAULT_MODEL_MAX_OUTPUT_TOKENS = 264_000;
export const DEFAULT_VISION_PROXY_SOURCE = '' as const;
export const DEFAULT_VISION_PROXY_MODEL_ID = '';
export const DEFAULT_VISION_PROXY_PROMPT = `Text extraction is mandatory. Visual description required except T2.5. See OUTPUT FORMAT.

---

TASK 1 - TEXT EXTRACTION (always):

1. Transcribe every detectable character verbatim - all text, symbols, and glyphs of any kind, in any location. Never correct, alter, summarize, paraphrase, or truncate the source.

2. Preserve formatting and spatial grouping:
  - Monospaced → code block (hint if known). Triple backticks in source → 4-backtick fence.
  - Proportional → plain text, paragraph breaks.
  - Tabular → Markdown table.
  - Ambiguous → code block.

3. Annotate spatial position:
  - Isolated elements: label + colon.
  - Multi-region: [Region: name] headers (avoids T1.4 collision).
    [Region: name]
    (content)

4. Uncertainty markers (place at position):
  [?] = uncertain char.
  [unclear] = uncertain span.
  [possible-artifact] = may not be text.
  [unreadable] = illegible.
  [truncated] = cut off at edge (place after last readable char).
  Never guess or fabricate. If source contains a marker literally, backslash-escape it.

5. Low-quality image: place after --- Extracted Text ---, before code block or transcription:
  (Low image quality - confidence reduced.)

6. No text: output "No text detected." No code block, no other text.

---

TASK 2 - VISUAL DESCRIPTION (unless T2.5):

1. Describe all non-text visual content.

2. Text-heavy: describe application, window chrome, UI state, and color coding.

3. Visual-primary: describe concisely but fully. Note color coding. Do not invent.

4. Diagrams: describe structure - what labels represent, how elements connect. Diagram should be understandable from both sections.

5. Omit Visual Context only for tightly cropped text. If any visual element beyond text is visible, include.

---

MULTIPLE IMAGES:

- Label "Image 1:", "Image 2:", etc. Single image: skip label.
- Combined summary only if images are related. If unsure, skip.

---

OUTPUT FORMAT:

Single image:
--- Extracted Text ---
[transcription]
--- Visual Context ---
[description]

If Visual Context omitted (T2.5), drop it.

Multiple images (repeat for each):
Image 1:
--- Extracted Text ---
[transcription]
--- Visual Context ---
[description]

--- Combined Summary ---
[summary - if applicable]

---

SPECIAL CASES:

- Handwriting: best-effort; prepend "(Handwriting - lower confidence.)".
- RTL: preserve direction; note in Visual Context.
- Overlapping layers: extract all; flag [Foreground:] / [Background:].
- Color: describe scheme in Visual Context only. Never encode in Extracted Text.
- Image-in-image: treat as flat; note nesting in Visual Context.
- Long lines: transcribe fully, no wrap; note overflow in Visual Context.

---

ESCAPING - if source text contains a line exactly matching any format marker, backslash-escape it:

- \\--- Extracted Text ---
- \\--- Visual Context ---
- \\--- Combined Summary ---
- \\Image N: (standalone line immediately before a \`---\` marker)

If source contains any T1.4 marker literally, backslash-escape it.`;

export const DEFAULT_MODELS = [
  {
    id: 'agent',
    name: 'Agent',
    modelId: '',
    toolMode: 'auto',
    visionMode: 'off',
    thinkingMode: 'off',
    thinkingEfforts: []
  }
] as const;
