CREATE TABLE "alert_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"domain_id" uuid NOT NULL,
	"alert_kind" text NOT NULL,
	"expiration_date" date NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resend_message_id" text,
	"status" text DEFAULT 'sent' NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"base_currency" char(3) DEFAULT 'EUR' NOT NULL,
	"alert_lead_days" integer[] DEFAULT '{60,30,14,7,1}'::integer[] NOT NULL,
	"alert_email_to" text,
	"alert_email_from" text,
	"alerts_enabled" boolean DEFAULT true NOT NULL,
	"sync_cron" text DEFAULT '0 6 * * *' NOT NULL,
	"timezone" text DEFAULT 'Europe/Berlin' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_settings_singleton" CHECK ("app_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registrar_account_id" uuid NOT NULL,
	"registrar_domain_id" text NOT NULL,
	"name" text NOT NULL,
	"encoded_name" text,
	"tld" text NOT NULL,
	"expiration_date" timestamp with time zone,
	"set_to_expire_on" timestamp with time zone,
	"set_to_renew_on" timestamp with time zone,
	"cancellation_date" timestamp with time zone,
	"auto_renew" boolean,
	"cancel_on_expire" boolean,
	"domain_lock" boolean,
	"transfer_lock" boolean,
	"privacy_enabled" boolean,
	"dns_sec_enabled" boolean,
	"domain_type" text,
	"registration_type" text,
	"provisioning_status" text,
	"compliance_status" text,
	"process_status" text,
	"transfer_status" text,
	"pending_provisioning" boolean DEFAULT false NOT NULL,
	"is_autorenew_switchable" boolean,
	"revive_possible_until" timestamp with time zone,
	"raw_detail" jsonb,
	"detail_fetched_at" timestamp with time zone,
	"price_override_cents" integer,
	"price_currency" char(3),
	"term_months_override" integer,
	"notes" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"project" text,
	"alerts_enabled" boolean DEFAULT true NOT NULL,
	"alert_lead_days" integer[],
	"is_favorite" boolean DEFAULT false NOT NULL,
	"sync_state" text DEFAULT 'active' NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_sync_run_id" uuid,
	"missing_since" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "domains_price_currency_required" CHECK ("domains"."price_override_cents" IS NULL OR "domains"."price_currency" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "registrar_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"credential_ref" text NOT NULL,
	"tenant_id" text,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_sync_status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_changes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"sync_run_id" uuid NOT NULL,
	"domain_id" uuid NOT NULL,
	"change_type" text NOT NULL,
	"field" text,
	"old_value" text,
	"new_value" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registrar_account_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"trigger" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	"domains_seen" integer DEFAULT 0 NOT NULL,
	"domains_created" integer DEFAULT 0 NOT NULL,
	"domains_updated" integer DEFAULT 0 NOT NULL,
	"domains_unchanged" integer DEFAULT 0 NOT NULL,
	"domains_missing" integer DEFAULT 0 NOT NULL,
	"detail_calls" integer DEFAULT 0 NOT NULL,
	"api_errors" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"error_detail" jsonb
);
--> statement-breakpoint
CREATE TABLE "tld_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tld" text NOT NULL,
	"renewal_cents" integer NOT NULL,
	"registration_cents" integer,
	"transfer_cents" integer,
	"currency" char(3) NOT NULL,
	"term_months" integer DEFAULT 12 NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert_log" ADD CONSTRAINT "alert_log_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domains" ADD CONSTRAINT "domains_registrar_account_id_registrar_accounts_id_fk" FOREIGN KEY ("registrar_account_id") REFERENCES "public"."registrar_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_changes" ADD CONSTRAINT "sync_changes_sync_run_id_sync_runs_id_fk" FOREIGN KEY ("sync_run_id") REFERENCES "public"."sync_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_changes" ADD CONSTRAINT "sync_changes_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_registrar_account_id_registrar_accounts_id_fk" FOREIGN KEY ("registrar_account_id") REFERENCES "public"."registrar_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_log_dedupe_key" ON "alert_log" USING btree ("domain_id","alert_kind","expiration_date");--> statement-breakpoint
CREATE INDEX "alert_log_sent_at_idx" ON "alert_log" USING btree ("sent_at");--> statement-breakpoint
CREATE UNIQUE INDEX "domains_account_registrar_id_key" ON "domains" USING btree ("registrar_account_id","registrar_domain_id");--> statement-breakpoint
CREATE UNIQUE INDEX "domains_account_name_key" ON "domains" USING btree ("registrar_account_id","name");--> statement-breakpoint
CREATE INDEX "domains_expiration_date_idx" ON "domains" USING btree ("expiration_date");--> statement-breakpoint
CREATE INDEX "domains_state_expiry_idx" ON "domains" USING btree ("sync_state","expiration_date");--> statement-breakpoint
CREATE INDEX "domains_tld_idx" ON "domains" USING btree ("tld");--> statement-breakpoint
CREATE INDEX "domains_account_idx" ON "domains" USING btree ("registrar_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "registrar_accounts_kind_label_key" ON "registrar_accounts" USING btree ("kind","label");--> statement-breakpoint
CREATE INDEX "sync_changes_domain_created_idx" ON "sync_changes" USING btree ("domain_id","created_at");--> statement-breakpoint
CREATE INDEX "sync_changes_run_idx" ON "sync_changes" USING btree ("sync_run_id");--> statement-breakpoint
CREATE INDEX "sync_runs_account_started_idx" ON "sync_runs" USING btree ("registrar_account_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tld_prices_tld_key" ON "tld_prices" USING btree ("tld");