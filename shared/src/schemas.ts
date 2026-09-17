import { z } from 'zod';

/**
 * Validation shared by the Express routes and the client forms, so a field can
 * only get out of sync with its validator in one place.
 */

export const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(3, 'Use a 3-letter ISO-4217 code, e.g. EUR');

export const tldSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(63)
  // Accepts multi-label TLDs like "co.uk"; rejects a leading dot.
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/, 'Invalid TLD');

export const centsSchema = z.number().int().min(0).max(100_000_00);

export const leadDaysSchema = z
  .array(z.number().int().min(0).max(365))
  .max(10)
  .transform((days) => [...new Set(days)].sort((a, b) => b - a));

/**
 * PATCH /api/domains/:id
 *
 * User-owned fields only. `.strict()` is load-bearing: it makes an attempt to
 * PATCH a registrar-owned field (expirationDate, autoRenew, ...) a 400 rather
 * than a silently ignored write that the next sync would "revert" confusingly.
 */
export const updateDomainBodySchema = z
  .object({
    priceOverrideCents: centsSchema.nullable(),
    priceCurrency: currencySchema.nullable(),
    termMonthsOverride: z.number().int().min(1).max(120).nullable(),
    notes: z.string().max(5000).nullable(),
    tags: z.array(z.string().trim().min(1).max(40)).max(25),
    project: z.string().trim().max(120).nullable(),
    alertsEnabled: z.boolean(),
    alertLeadDays: leadDaysSchema.nullable(),
    isFavorite: z.boolean(),
  })
  .partial()
  .strict()
  .refine(
    (body) => body.priceOverrideCents == null || body.priceCurrency != null,
    { message: 'priceCurrency is required when setting a price override', path: ['priceCurrency'] },
  );

export const upsertTldPriceBodySchema = z
  .object({
    renewalCents: centsSchema,
    registrationCents: centsSchema.nullable().optional(),
    transferCents: centsSchema.nullable().optional(),
    currency: currencySchema,
    termMonths: z.number().int().min(1).max(120).default(12),
    notes: z.string().max(1000).nullable().optional(),
  })
  .strict();

export const domainQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  tld: z.union([tldSchema, z.array(tldSchema)]).optional(),
  state: z.enum(['active', 'missing', 'archived', 'all']).default('active'),
  tag: z.union([z.string(), z.array(z.string())]).optional(),
  project: z.string().trim().max(120).optional(),
  expiringWithinDays: z.coerce.number().int().min(0).max(3650).optional(),
  autoRenew: z.enum(['true', 'false']).optional(),
  priceKnown: z.enum(['true', 'false']).optional(),
  favorite: z.enum(['true', 'false']).optional(),
  sort: z.enum(['name', 'expiry', 'cost', 'tld', 'created']).default('expiry'),
  dir: z.enum(['asc', 'desc']).default('asc'),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
  offset: z.coerce.number().int().min(0).default(0),
});

export const startSyncBodySchema = z
  .object({
    accountId: z.string().uuid().optional(),
    mode: z.enum(['full', 'quick']).default('full'),
  })
  .strict();

export const updateSettingsBodySchema = z
  .object({
    baseCurrency: currencySchema,
    alertLeadDays: leadDaysSchema,
    alertEmailTo: z.string().email().nullable(),
    alertEmailFrom: z.string().email().nullable(),
    alertsEnabled: z.boolean(),
    // Five or six space-separated cron fields.
    syncCron: z
      .string()
      .trim()
      .regex(/^(\S+\s+){4,5}\S+$/, 'Expected a 5- or 6-field cron expression'),
    timezone: z.string().trim().min(1).max(64),
  })
  .partial()
  .strict();

export const testAlertBodySchema = z
  .object({ to: z.string().email().optional() })
  .strict();

export const bulkTldPriceBodySchema = z
  .object({
    currency: currencySchema,
    termMonths: z.number().int().min(1).max(120).default(12),
    entries: z
      .array(z.object({ tld: tldSchema, renewalCents: centsSchema }))
      .min(1)
      .max(500),
  })
  .strict();

export type UpdateDomainBody = z.infer<typeof updateDomainBodySchema>;
export type UpsertTldPriceBody = z.infer<typeof upsertTldPriceBodySchema>;
export type DomainQuery = z.infer<typeof domainQuerySchema>;
export type StartSyncBody = z.infer<typeof startSyncBodySchema>;
export type UpdateSettingsBody = z.infer<typeof updateSettingsBodySchema>;
export type BulkTldPriceBody = z.infer<typeof bulkTldPriceBodySchema>;
