import type { RouterUsageEntry, RouterUsageQuota, RouterUsageSnapshot } from '@/router/usage';
import {
  formatAmount,
  formatProviderName,
  formatResetLabel,
  formatTimestamp,
  quotaRemainingPercent,
  quotaTone
} from '@/webview/shared/usage-format';
import { resolveProviderIcon } from '@/webview/shared/provider-icons';

export { formatResetLabel } from '@/webview/shared/usage-format';

const REFRESH_COMMAND_HREF = 'command:9routerCopilot.showUsage';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function providerInitial(provider: string): string {
  const trimmed = provider.trim();
  return trimmed.length === 0 ? '?' : trimmed.charAt(0).toUpperCase();
}

function renderProviderAvatar(provider: string): string {
  const icon = resolveProviderIcon(provider);
  if (!icon) {
    return `<div class="avatar generic" aria-hidden="true">${escapeHtml(providerInitial(provider))}</div>`;
  }

  return `<div class="avatar provider-logo" data-provider-logo="${icon.slug}" aria-hidden="true">
  <span>${escapeHtml(providerInitial(provider))}</span>
  <img src="${icon.url}" alt="" loading="lazy" referrerpolicy="no-referrer" />
</div>`;
}

function refreshIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
  <path d="M20 12a8 8 0 1 1-2.2-5.5"/>
  <path d="M20 5v5h-5"/>
</svg>`;
}

function renderQuotaRow(name: string, quota: RouterUsageQuota, nowMs: number): string {
  const percent = quotaRemainingPercent(quota);
  const tone = quota.unlimited ? 'ok' : quotaTone(percent);
  const reset = quota.unlimited ? 'N/A' : formatResetLabel(quota.resetAt, nowMs);

  return `<section class="quota">
  <div class="quota-name"><span class="dot ${tone}"></span>${escapeHtml(name)}</div>
  <div class="used">${escapeHtml(formatAmount(quota.used))} / ${escapeHtml(formatAmount(quota.total))}</div>
  <div class="bar ${tone}" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}" aria-label="${escapeHtml(name)} remaining">
    <div class="fill" style="width:${percent}%"></div>
  </div>
  <div class="remaining ${tone}">${percent}%</div>
  <div class="reset">${escapeHtml(reset)}</div>
</section>`;
}

function renderConnection(entry: RouterUsageEntry, nowMs: number): string {
  const quotas = Object.entries(entry.quotas);
  const quotaCountLabel = `${quotas.length} quota${quotas.length === 1 ? '' : 's'}`;
  const quotaBlocks =
    quotas.length === 0
      ? '<p class="empty">No quotas reported for this connection.</p>'
      : quotas.map(([name, quota]) => renderQuotaRow(name, quota, nowMs)).join('\n');
  const stale = entry.stale ? '<span class="chip">stale</span>' : '';
  const status =
    entry.status.trim().toLowerCase() === 'ok'
      ? ''
      : `<span class="chip">${escapeHtml(entry.status)}</span>`;
  const message =
    entry.message && entry.message.trim().length > 0
      ? `<p class="message">${escapeHtml(entry.message)}</p>`
      : '';

  return `<article class="card">
  <header class="card-head">
    <div class="identity">
      ${renderProviderAvatar(entry.provider)}
      <div class="copy">
        <div class="provider">${escapeHtml(formatProviderName(entry.provider))}</div>
        <div class="account">${escapeHtml(entry.name)}</div>
        <div class="plan">${escapeHtml(entry.plan)} · ${escapeHtml(entry.authType)}</div>
      </div>
    </div>
    <div class="actions">
      ${stale}
      ${status}
      <a class="icon-btn" href="${REFRESH_COMMAND_HREF}" title="Refresh usage" aria-label="Refresh usage">${refreshIcon()}</a>
    </div>
  </header>
  ${message}
  <p class="quota-count">${quotaCountLabel}</p>
  ${quotaBlocks}
</article>`;
}

export function formatUsageHtml(
  snapshot: RouterUsageSnapshot,
  options: { nowMs?: number } = {}
): string {
  const nowMs = options.nowMs ?? Date.now();
  const body =
    snapshot.entries.length === 0
      ? '<p class="empty page-empty">No connection usage entries returned.</p>'
        : `<div class="board">${snapshot.entries
          .map((entry) => renderConnection(entry, nowMs))
          .join('\n')}</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src https://unpkg.com;" />
  <title>9router Usage</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: var(--vscode-editor-background, #1e1e1e);
      --fg: var(--vscode-editor-foreground, #e8e8e8);
      --muted: var(--vscode-descriptionForeground, #9a9a9a);
      --subtle: color-mix(in srgb, var(--muted) 80%, var(--fg));
      --card: var(--vscode-editorWidget-background, color-mix(in srgb, var(--bg) 88%, #000));
      --border: var(--vscode-widget-border, color-mix(in srgb, var(--fg) 12%, transparent));
      --ok: #3dd68c;
      --warn: #e3b341;
      --critical: #f85149;
      --track-ok: color-mix(in srgb, var(--ok) 22%, transparent);
      --track-warn: color-mix(in srgb, var(--warn) 22%, transparent);
      --track-critical: color-mix(in srgb, var(--critical) 22%, transparent);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 24px;
      background: var(--bg);
      color: var(--fg);
      font: 13px/1.4 var(--vscode-font-family, ui-sans-serif, system-ui, sans-serif);
    }
    .page-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      max-width: 1180px;
      margin: 0 auto 18px;
    }
    h1 {
      margin: 0 0 4px;
      font-size: 18px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .sweep, .empty, .reset, .account, .plan, .quota-count, .message {
      color: var(--muted);
    }
    .sweep { margin: 0; font-size: 12px; }
    .board {
      max-width: 1180px;
      margin: 0 auto;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 16px 18px 12px;
      min-width: 0;
    }
    .card-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }
    .identity {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }
    .avatar {
      width: 45px;
      height: 45px;
      border-radius: 999px;
      display: grid;
      place-items: center;
      flex-shrink: 0;
      color: var(--fg);
      font-size: 18px;
      font-weight: 700;
      background: color-mix(in srgb, var(--fg) 9%, var(--card));
    }
    .avatar.provider-logo { position: relative; color: #111; background: #f4f4f4; }
    .avatar.provider-logo span { font-size: 16px; font-weight: 700; }
    .avatar img {
      position: absolute;
      top: 50%;
      left: 50%;
      display: block;
      width: 26px;
      height: 26px;
      transform: translate(-50%, -50%);
    }
    .copy { min-width: 0; }
    .provider {
      font-size: 15px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .account, .plan {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .account { font-size: 12px; }
    .plan { font-size: 11px; margin-top: 1px; }
    .actions {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }
    .chip {
      font-size: 10px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--muted);
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 2px 7px;
    }
    .icon-btn {
      width: 28px;
      height: 28px;
      border-radius: 8px;
      color: var(--muted);
      display: grid;
      place-items: center;
      text-decoration: none;
    }
    .icon-btn:hover { color: var(--fg); background: color-mix(in srgb, var(--fg) 8%, transparent); }
    .icon-btn svg { width: 15px; height: 15px; }
    .message {
      margin: 12px 0 0;
      padding: 8px 10px;
      border-left: 3px solid var(--critical);
      background: color-mix(in srgb, var(--critical) 12%, transparent);
    }
    .quota-count {
      margin: 14px 0 4px;
      font-size: 12px;
    }
    .quota {
      display: grid;
      grid-template-columns: minmax(92px, 118px) minmax(0, 1fr) 42px 88px;
      grid-template-areas:
        "name used remaining reset"
        "name bar remaining reset";
      column-gap: 10px;
      row-gap: 3px;
      align-items: center;
      padding: 8px 0;
    }
    .quota-name {
      grid-area: name;
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12.5px;
      min-width: 0;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
      background: var(--ok);
    }
    .dot.warn { background: var(--warn); }
    .dot.critical { background: var(--critical); }
    .used {
      grid-area: used;
      color: var(--subtle);
      font-size: 11px;
      font-variant-numeric: tabular-nums;
    }
    .bar {
      grid-area: bar;
      height: 4px;
      border-radius: 999px;
      overflow: hidden;
      background: var(--track-ok);
    }warn { background: var(--track-warn); }
    .bar.critical { background: var(--track-critical); }
    .bar .fill {
      height: 100%;
      border-radius: inherit;
      background: var(--ok);
    }
    .bar.warn .fill { background: var(--warn);   background: var(--ok);
    }
    .bar.critical .fill { background: var(--critical); }
    .remaining {
      grid-area: remaining;
      justify-self: end;
      font-size: 12px;
      font-weight: 600;
      font-variwarn { color: var(--warn); }
    .remaining.ant-numeric: tabular-nums;
      color: var(--ok);
    }
    .remaining.critical { color: var(--critical); }
    .reset {
      grid-area: reset;
      font-size: 12px;
      white-space: nowrap;
    }
    .empty { margin: 8px 0 4px; }
    .page-empty { max-width: 1180px; margin: 24px auto; }
    @media (max-width: 860px) {
      .board { grid-template-columns: 1fr; }
      .quota {
        grid-template-columns: minmax(84px, 1fr) auto;
        grid-template-areas:
          "name remaining"
          "used reset"
          "bar bar";
      }
    }
  </style>
</head>
<body>
  <header class="page-head">
    <div>
      <h1>Usage</h1>
      <p class="sweep">Last sweep · ${escapeHtml(formatTimestamp(snapshot.lastSweepAt))}</p>
    </div>
    <a class="icon-btn" href="${REFRESH_COMMAND_HREF}" title="Refresh usage" aria-label="Refresh usage">${refreshIcon()}</a>
  </header>
  ${body}
</body>
</html>`;
}
