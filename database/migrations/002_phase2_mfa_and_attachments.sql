-- 002_phase2_mfa_and_attachments.sql
-- Phase 2 / Slice 9: MFA (TOTP + Single-Use Recovery Codes) & Transaction Attachments
-- Idempotent PostgreSQL 16+ migration enforcing composite FK tenant isolation,
-- strict MIME allowlist, 5 MiB size limit, and cascade cleanup.

BEGIN;

-- 1. Ensure transactions exposes UNIQUE (id, user_id) for composite tenant-isolated FKs
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        WHERE c.conrelid = 'transactions'::regclass
          AND c.contype = 'u'
          AND (
              c.conname = 'uq_transactions_id_user'
              OR (
                  SELECT array_agg(a.attname::text ORDER BY k.ord)
                  FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
                  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
              ) = ARRAY['id', 'user_id']
          )
    ) THEN
        ALTER TABLE transactions
            ADD CONSTRAINT uq_transactions_id_user UNIQUE (id, user_id);
    END IF;
END
$$;

-- 2. User MFA (AES-256-GCM Encrypted TOTP Secret)
CREATE TABLE IF NOT EXISTS user_mfa (
    user_id               UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    totp_secret_encrypted TEXT NOT NULL,
    enabled_at            TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Single-Use MFA Recovery Codes (SHA-256 hashes only)
CREATE TABLE IF NOT EXISTS user_mfa_recovery_codes (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash  CHAR(64) NOT NULL,
    used_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_mfa_recovery_codes_user_id
    ON user_mfa_recovery_codes(user_id);

-- 4. Transaction Attachments (Magic-Bytes Verified, Composite FK Tenant Isolated)
CREATE TABLE IF NOT EXISTS transaction_attachments (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    transaction_id    UUID NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    stored_filename   VARCHAR(128) NOT NULL UNIQUE,
    mime_type         VARCHAR(64) NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'application/pdf')),
    size_bytes        INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
    sha256_hash       CHAR(64) NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (transaction_id, user_id) REFERENCES transactions(id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_transaction_attachments_tx_user
    ON transaction_attachments(transaction_id, user_id);

COMMIT;
