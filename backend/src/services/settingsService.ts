import type { AppSettingsDTO, UpdateSettingsBody } from '@domain-check/shared';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { appSettings, type AppSettingsRow } from '../db/schema.js';

/** Settings live in a single row; this creates it on first read if missing. */
export async function getSettings(db: Database): Promise<AppSettingsRow> {
  const existing = await db.query.appSettings.findFirst({ where: eq(appSettings.id, 1) });
  if (existing) return existing;

  const [created] = await db
    .insert(appSettings)
    .values({ id: 1 })
    .onConflictDoNothing({ target: appSettings.id })
    .returning();
  if (created) return created;

  // Lost the insert race — the row now exists.
  const row = await db.query.appSettings.findFirst({ where: eq(appSettings.id, 1) });
  if (!row) throw new Error('app_settings row could not be created');
  return row;
}

export async function updateSettings(db: Database, patch: UpdateSettingsBody): Promise<AppSettingsRow> {
  await getSettings(db);
  const [updated] = await db
    .update(appSettings)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(appSettings.id, 1))
    .returning();
  return updated!;
}

export function toSettingsDTO(row: AppSettingsRow): AppSettingsDTO {
  return {
    baseCurrency: row.baseCurrency,
    alertLeadDays: row.alertLeadDays,
    alertEmailTo: row.alertEmailTo,
    alertEmailFrom: row.alertEmailFrom,
    alertsEnabled: row.alertsEnabled,
    syncCron: row.syncCron,
    timezone: row.timezone,
    updatedAt: row.updatedAt.toISOString(),
  };
}
