-- Add created_at / updated_at to session and account.
--
-- Better-Auth's drizzle adapter expects these columns on every auth table.
-- Original 0004_auth_tables.sql created session/account without them, which
-- caused: BetterAuthError "The field 'createdAt' does not exist in the
-- 'session' Drizzle schema" on the magic-link verify path.
ALTER TABLE "session"
  ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "account"
  ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
