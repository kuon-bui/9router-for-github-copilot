# Codex Prompt Export Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chuyển việc tải Codex instructions từ lúc extension activation sang khi chạy command export, loại bỏ silent fallback chuỗi cũ, và bổ sung test phủ toàn bộ luồng export.

**Architecture:** Giữ `src/config/codex-export.ts` là adapter thuần, đồng bộ. Extension activation trong `src/runtime/activate.ts` không đọc filesystem của Codex prompt nữa mà truyền callback bất đồng bộ bắt buộc `loadCodexInstructions: () => Promise<string>` vào `createCodexExporter` trong `src/runtime/export-codex-config.ts`. Exporter chỉ gọi loader sau khi người dùng đã xác nhận đích đến và xác nhận ghi đè, kiểm tra prompt không rỗng, và chuyển lỗi đọc file thành `NineRouterError('CONFIGURATION_ERROR', ...)`.

**Tech Stack:** TypeScript, VS Code Extension API, Vitest, Node.js `node:fs/promises`.

**Spec:** `docs/superpowers/specs/2026-09-21-codex-config-export-design.md`

## Global Constraints

- Không làm chậm hoặc chặn extension activation khi file prompt Codex bị lỗi, thiếu hoặc rỗng.
- Không giữ fallback silent string cũ `'You are a coding agent connected through 9router.'`.
- `buildCodexExport` và `buildCodexCatalogModels` giữ nguyên tính thuần túy (pure functions, synchronous), không đọc filesystem.
- Bắt buộc kiểm tra nội dung prompt rỗng / whitespace ở tầng loader và tầng exporter.
- Toàn bộ 5 lệnh kiểm tra chất lượng phải vượt qua: `pnpm run build`, `pnpm run lint`, `pnpm run test:unit`, `pnpm run test:integration`, `pnpm run package`.

## Review Focus

1. Extension activate thành công và đăng ký provider bình thường ngay cả khi loader Codex prompt bị lỗi (ví dụ file bị xoá).
2. Hủy Quick Pick hoặc hủy xác nhận ghi đè không được kích hoạt `loadCodexInstructions` và không ghi bất kỳ file nào.
3. Loader trả về chuỗi rỗng / whitespace sẽ làm command export báo lỗi `CONFIGURATION_ERROR` rõ ràng, không tạo thư mục và không ghi file.
4. Mọi model xuất ra trong file `9router-models.json` đều nhận chính xác 100% nội dung từ file Markdown được tải.
5. Khi ghi đè bị từ chối hoặc lỗi xảy ra, các file đã có từ trước không bị thay đổi.

---

### Task 1: Thêm kiểm tra file rỗng cho loader và cập nhật unit test loader

**Files:**
- Modify: `src/config/read-codex-instructions.ts:1-25`
- Modify: `test/unit/config/read-codex-instructions.test.ts:1-35`

**Interfaces:**
- Produces: `readDefaultCodexInstructions(extensionPath: string): Promise<string>` ném lỗi `Default Codex instructions are empty: <path>` khi file rỗng hoặc chỉ có whitespace.

- [ ] **Step 1: Viết failing test cho trường hợp file prompt rỗng hoặc chỉ chứa khoảng trắng**

Cập nhật `test/unit/config/read-codex-instructions.test.ts`:
```typescript
it('rejects empty or whitespace-only instructions prompt file', async () => {
  const extensionPath = await mkdtemp(join(tmpdir(), '9router-empty-prompt-'));
  const promptDir = join(extensionPath, 'prompts/codex');
  await mkdir(promptDir, { recursive: true });
  await writeFile(join(promptDir, 'default-codex-instructions.md'), '   \n\t  ', 'utf8');

  try {
    await expect(readDefaultCodexInstructions(extensionPath)).rejects.toThrow(
      /Default Codex instructions are empty:/
    );
  } finally {
    await rm(extensionPath, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Chạy test để xác nhận test chạy**

Run: `pnpm exec vitest run test/unit/config/read-codex-instructions.test.ts`
Expected: PASS (nếu loader đã có sẵn kiểm tra) hoặc FAIL (nếu chưa xử lý đúng whitespace).

- [ ] **Step 3: Cập nhật loader đảm bảo trim và kiểm tra độ dài**

Trong `src/config/read-codex-instructions.ts`:
```typescript
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const DEFAULT_CODEX_INSTRUCTIONS_PATH = join(
  'prompts/codex',
  'default-codex-instructions.md'
);

export async function readDefaultCodexInstructions(extensionPath: string): Promise<string> {
  const path = resolve(extensionPath, DEFAULT_CODEX_INSTRUCTIONS_PATH);
  let prompt: string;

  try {
    prompt = (await readFile(path, 'utf8')).trim();
  } catch (cause) {
    throw new Error(`Unable to read default Codex instructions: ${path}`, { cause });
  }

  if (prompt.length === 0) {
    throw new Error(`Default Codex instructions are empty: ${path}`);
  }

  return prompt;
}
```

- [ ] **Step 4: Chạy lại test để đảm bảo xanh**

Run: `pnpm exec vitest run test/unit/config/read-codex-instructions.test.ts`
Expected: PASS

---

### Task 2: Chuyển exporter sang nhận callback `loadCodexInstructions` bắt buộc, loại bỏ fallback

**Files:**
- Modify: `src/runtime/export-codex-config.ts:130-280`
- Modify: `test/unit/runtime/export-codex-config.test.ts:80-360`

**Interfaces:**
- Consumes: `loadCodexInstructions: () => Promise<string>`
- Produces: `createCodexExporter(dependencies: { getSettingsSnapshot: () => SettingsSnapshot | undefined; loadCodexInstructions: () => Promise<string>; env?: Record<string, string | undefined>; homedir?: () => string; fs?: CodexExportFs; }): CodexExporter`

- [ ] **Step 1: Viết failing test trong `export-codex-config.test.ts` cho việc gọi loader sau xác nhận và từ chối prompt rỗng**

Thêm các test cases vào `test/unit/runtime/export-codex-config.test.ts`:
1. `does not invoke loadCodexInstructions when user cancels destination`
2. `throws CONFIGURATION_ERROR when loadCodexInstructions fails or returns blank string`
3. `passes loaded prompt to all models in exported catalog`

- [ ] **Step 2: Chạy test để xác nhận FAIL**

Run: `pnpm exec vitest run test/unit/runtime/export-codex-config.test.ts`
Expected: FAIL do interface và logic chưa được cập nhật.

- [ ] **Step 3: Cập nhật `createCodexExporter` trong `src/runtime/export-codex-config.ts`**

1. Đổi kiểu tham số: `loadCodexInstructions: () => Promise<string>` (bắt buộc).
2. Xóa bỏ hoàn toàn fallback comment và fallback string.
3. Sau khi người dùng đã chọn đích và xác nhận overwrite thành công:
```typescript
let instructionsTemplate: string;
try {
  instructionsTemplate = (await dependencies.loadCodexInstructions()).trim();
  if (instructionsTemplate.length === 0) {
    throw new Error('Codex instructions prompt is empty.');
  }
} catch (error) {
  const detail = error instanceof Error ? error.message : 'unknown prompt load error';
  throw new NineRouterError('CONFIGURATION_ERROR', `Failed to load Codex instructions: ${detail}`, {
    ...(error instanceof Error ? { details: { cause: error.message } } : {})
  });
}
```
4. Truyền `instructionsTemplate` vào `buildCodexExport`.
5. Cập nhật tất cả các fixture gọi `createCodexExporter` trong `test/unit/runtime/export-codex-config.test.ts` để truyền `loadCodexInstructions: async () => 'Test instructions.'`.

- [ ] **Step 4: Chạy test để đảm bảo xanh**

Run: `pnpm exec vitest run test/unit/runtime/export-codex-config.test.ts`
Expected: PASS

---

### Task 3: Chuyển extension activation sang lazy prompt loading và cập nhật integration test

**Files:**
- Modify: `src/runtime/activate.ts:40-100`
- Modify: `test/unit/runtime/activate.test.ts:1-60`
- Modify: `test/integration/extension/export-codex-config-command.test.ts:1-60`

**Interfaces:**
- Consumes: `readDefaultCodexInstructions`
- Produces: `activateExtension` không await đọc prompt Codex; truyền callback `() => readDefaultCodexInstructions(context.extensionPath)` vào `createCodexExporter`.

- [ ] **Step 1: Viết failing test trong `activate.test.ts` chứng minh activation không gọi loader Codex prompt trước**

Trong `test/unit/runtime/activate.test.ts`:
```typescript
it('activates successfully without reading Codex instructions during activation', async () => {
  const context = {
    secrets: { get: async () => undefined },
    subscriptions: [],
    extensionUri: Uri.file('/ext'),
    extensionPath: '/ext'
  } as never;

  const readInstructionsMock = vi.fn(async () => {
    throw new Error('Should not be called during activation');
  });

  await expect(
    activateExtension(context, {
      readDefaultVisionProxyPrompt: async () => 'Default Vision prompt.',
      readDefaultCodexInstructions: readInstructionsMock,
      createProvider: () => ({
        getSnapshot: () => undefined,
        refreshFromSnapshot: () => undefined,
        dispose: vi.fn()
      } as unknown as NineRouterChatProvider)
    })
  ).resolves.toBeUndefined();

  expect(readInstructionsMock).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Chạy test để xác nhận FAIL**

Run: `pnpm exec vitest run test/unit/runtime/activate.test.ts`
Expected: FAIL vì `activateExtension` hiện đang gọi `await readDefaultCodexInstructions(...)` ngay khi kích hoạt.

- [ ] **Step 3: Cập nhật `src/runtime/activate.ts`**

1. Bỏ dòng `const defaultCodexInstructions = await (hooks.readDefaultCodexInstructions ?? readDefaultCodexInstructions)(context.extensionPath);`.
2. Khởi tạo `exportCodexConfig`:
```typescript
const readCodexInstructions =
  hooks.readDefaultCodexInstructions ?? readDefaultCodexInstructions;
const exportCodexConfig = createCodexExporter({
  getSettingsSnapshot: () => provider?.getSnapshot(),
  loadCodexInstructions: () => readCodexInstructions(context.extensionPath)
});
```

- [ ] **Step 4: Chạy test để đảm bảo xanh**

Run: `pnpm exec vitest run test/unit/runtime/activate.test.ts`
Expected: PASS

---

### Task 4: Bổ sung Integration Test luồng end-to-end cho Export Command với prompt thật

**Files:**
- Modify: `test/integration/extension/export-codex-config-command.test.ts`

- [ ] **Step 1: Thêm integration test kiểm tra nội dung Markdown trong catalog sau khi chạy qua command**

Kiểm tra:
- Khởi tạo command thông qua exporter thật với `loadCodexInstructions` trả về prompt mẫu hoặc file thật.
- Gọi command `9routerCopilot.exportCodexConfig`.
- Kiểm tra file `9router-models.json` được tạo chứa chính xác nội dung prompt cho toàn bộ model được cấu hình.

- [ ] **Step 2: Chạy toàn bộ test integration**

Run: `pnpm run test:integration`
Expected: PASS

---

### Task 5: Cập nhật Design Spec và chạy toàn bộ Verification Gate

**Files:**
- Modify: `docs/superpowers/specs/2026-09-21-codex-config-export-design.md`

- [ ] **Step 1: Cập nhật tài liệu thiết kế**

Ghi rõ trong spec:
- `instructions_template` được nạp theo cơ chế lazy từ `prompts/codex/default-codex-instructions.md` khi chạy command export.
- Lỗi nạp prompt (file thiếu, rỗng, không đọc được) chỉ làm fail command export với mã `CONFIGURATION_ERROR`, không ảnh hưởng tới activation của extension.

- [ ] **Step 2: Chạy toàn bộ Verification Gate**

Run các lệnh sau theo thứ tự:
1. `pnpm run build`
2. `pnpm run lint`
3. `pnpm run test:unit`
4. `pnpm run test:integration`
5. `pnpm run package`

- [ ] **Step 3: Xác minh VSIX được tạo ra chứa file prompt chính xác**

Kiểm tra file `.vsix` mới nhất đảm bảo có `extension/prompts/codex/default-codex-instructions.md`.
