import { describeAlertKind, formatMoney } from '@domain-check/shared';
import type { ClaimedAlert } from './alertService.js';
import type { EmailMessage } from './emailTransport.js';

/**
 * One digest per run, grouped by urgency — not one mail per alert.
 *
 * With 30 domains and five thresholds, per-domain mail produces bursts the user
 * starts filtering to trash within a week, which defeats the entire feature.
 */

interface DigestOptions {
  to: string;
  from: string;
  baseCurrency: string;
  isTest?: boolean;
}

interface Group {
  title: string;
  accent: string;
  alerts: ClaimedAlert[];
}

function group(alerts: ClaimedAlert[]): Group[] {
  const expired: ClaimedAlert[] = [];
  const critical: ClaimedAlert[] = [];
  const warning: ClaimedAlert[] = [];
  const risk: ClaimedAlert[] = [];

  for (const alert of alerts) {
    if (alert.kind === 'expired') expired.push(alert);
    else if (alert.kind === 'cancel_on_expire' || alert.kind === 'autorenew_off' || alert.kind === 'disappeared')
      risk.push(alert);
    else if (alert.domain.daysLeft !== null && alert.domain.daysLeft <= 7) critical.push(alert);
    else warning.push(alert);
  }

  return [
    { title: 'Expired', accent: '#ef4444', alerts: expired },
    { title: 'Expiring this week', accent: '#ef4444', alerts: critical },
    { title: 'Expiring soon', accent: '#f59e0b', alerts: warning },
    { title: 'Needs attention', accent: '#a1a1aa', alerts: risk },
  ].filter((entry) => entry.alerts.length > 0);
}

export function renderDigest(alerts: ClaimedAlert[], options: DigestOptions): EmailMessage {
  const groups = group(alerts);
  const totalCents = alerts.reduce((sum, alert) => {
    const price = alert.domain.effectivePrice;
    // Only same-currency prices are summed; see the no-FX policy in pricing.ts.
    if (price.renewalCents === null || price.currency !== options.baseCurrency) return sum;
    return sum + price.renewalCents;
  }, 0);

  const prefix = options.isTest ? '[Test] ' : '';
  const subject =
    alerts.length === 1 && alerts[0]
      ? `${prefix}${alerts[0].domain.name} — ${describeAlertKind(alerts[0].kind)}`
      : `${prefix}${alerts.length} domains need attention`;

  return { to: options.to, from: options.from, subject, html: html(groups, totalCents, options), text: text(groups, totalCents, options) };
}

function daysLabel(alert: ClaimedAlert): string {
  const days = alert.domain.daysLeft;
  if (days === null) return 'unknown';
  if (days < 0) return `${Math.abs(days)}d ago`;
  if (days === 0) return 'today';
  return `${days}d`;
}

function costLabel(alert: ClaimedAlert): string {
  const price = alert.domain.effectivePrice;
  if (price.renewalCents === null) return 'no price set';
  return formatMoney(price.renewalCents, price.currency);
}

function renewLabel(alert: ClaimedAlert): string {
  if (alert.domain.cancelOnExpire) return 'set to cancel';
  if (alert.domain.autoRenew === true) return 'auto-renew on';
  if (alert.domain.autoRenew === false) return 'auto-renew OFF';
  return 'unknown';
}

function text(groups: Group[], totalCents: number, options: DigestOptions): string {
  const lines: string[] = [];
  if (options.isTest) lines.push('This is a test of your Domain Check alert digest.', '');

  for (const entry of groups) {
    lines.push(entry.title.toUpperCase(), '-'.repeat(entry.title.length));
    for (const alert of entry.alerts) {
      lines.push(
        `  ${alert.domain.name}  ${daysLabel(alert)}  ${alert.domain.effectiveExpiry?.slice(0, 10) ?? '—'}  ${costLabel(alert)}  ${renewLabel(alert)}`,
      );
    }
    lines.push('');
  }

  if (totalCents > 0) {
    lines.push(`Total renewal cost in this digest: ${formatMoney(totalCents, options.baseCurrency)}`);
  }
  return lines.join('\n');
}

function html(groups: Group[], totalCents: number, options: DigestOptions): string {
  const sections = groups
    .map(
      (entry) => `
      <tr><td style="padding:24px 24px 8px 24px">
        <div style="font:600 12px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;letter-spacing:.06em;text-transform:uppercase;color:${entry.accent}">
          ${escapeHtml(entry.title)} · ${entry.alerts.length}
        </div>
      </td></tr>
      <tr><td style="padding:0 24px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
          ${entry.alerts.map((alert) => row(alert)).join('')}
        </table>
      </td></tr>`,
    )
    .join('');

  return `<!doctype html>
<html><body style="margin:0;background:#09090b;padding:32px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#18181b;border:1px solid #27272a;border-radius:12px;overflow:hidden">
  <tr><td style="padding:24px 24px 0 24px">
    <div style="font:600 16px/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#fafafa">Domain Check</div>
    <div style="font:400 13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#a1a1aa;margin-top:4px">
      ${options.isTest ? 'Test digest — no alerts were recorded.' : 'Domains in your portfolio need attention.'}
    </div>
  </td></tr>
  ${sections}
  ${
    totalCents > 0
      ? `<tr><td style="padding:16px 24px 24px 24px;border-top:1px solid #27272a;margin-top:16px">
           <div style="font:400 13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#a1a1aa">
             Total renewal cost in this digest:
             <span style="color:#fafafa;font-weight:600">${escapeHtml(formatMoney(totalCents, options.baseCurrency))}</span>
           </div>
         </td></tr>`
      : '<tr><td style="height:24px"></td></tr>'
  }
</table>
</td></tr></table>
</body></html>`;
}

function row(alert: ClaimedAlert): string {
  const urgent = alert.domain.daysLeft !== null && alert.domain.daysLeft <= 7;
  const renewOff = alert.domain.autoRenew === false || alert.domain.cancelOnExpire === true;
  return `<tr>
    <td style="padding:8px 0;border-bottom:1px solid #27272a">
      <div style="font:500 14px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#fafafa">${escapeHtml(alert.domain.name)}</div>
      <div style="font:400 12px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#71717a;margin-top:2px">
        ${escapeHtml(describeAlertKind(alert.kind))} · ${escapeHtml(alert.domain.effectiveExpiry?.slice(0, 10) ?? 'no expiry')}
      </div>
    </td>
    <td align="right" style="padding:8px 0;border-bottom:1px solid #27272a;white-space:nowrap">
      <div style="font:600 13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:${urgent ? '#ef4444' : '#fafafa'}">${escapeHtml(daysLabel(alert))}</div>
      <div style="font:400 12px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:${renewOff ? '#f59e0b' : '#71717a'};margin-top:2px">
        ${escapeHtml(costLabel(alert))} · ${escapeHtml(renewLabel(alert))}
      </div>
    </td>
  </tr>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
