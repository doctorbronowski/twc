export const activitySchemaStatement = `CREATE TABLE IF NOT EXISTS work_search_activities (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  activity_date DATE NULL,
  job_source VARCHAR(255) NULL,
  job_source_url VARCHAR(2048) NULL,
  job_title VARCHAR(255) NULL,
  employer_name VARCHAR(255) NULL,
  employer_address1 VARCHAR(255) NULL,
  employer_address2 VARCHAR(255) NULL,
  employer_city VARCHAR(100) NULL,
  employer_state CHAR(2) NULL,
  employer_zip VARCHAR(10) NULL,
  employer_phone VARCHAR(10) NULL,
  employer_contact VARCHAR(255) NULL,
  employer_email VARCHAR(255) NULL,
  hiring_result ENUM('hired', 'not_hired') NULL,
  start_date DATE NULL,
  application_filed TINYINT(1) NOT NULL DEFAULT 0,
  result_other VARCHAR(255) NULL,
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`

export function isUnsignedIntColumnType(columnType: string): boolean {
  return /^int(?:\(\d+\))? unsigned$/i.test(columnType)
}

export const accountSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS \`account\` (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    username VARCHAR(254) NOT NULL,
    pending_email VARCHAR(254) NULL,
    password_hash VARCHAR(255) NOT NULL,
    kind ENUM('regular', 'demo') NOT NULL DEFAULT 'regular',
    email_verified_at DATETIME(3) NULL,
    disabled_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_account_username (username),
    UNIQUE KEY uq_account_pending_email (pending_email)
  ) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
  `CREATE TABLE IF NOT EXISTS account_email_verification_tokens (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    account_id INT UNSIGNED NOT NULL,
    token_hash BINARY(32) NOT NULL,
    expires_at DATETIME(3) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    consumed_at DATETIME(3) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_account_email_verification_tokens_hash (token_hash),
    KEY idx_account_email_verification_tokens_account (account_id),
    KEY idx_account_email_verification_tokens_expiry (expires_at),
    CONSTRAINT fk_account_email_verification_tokens_account
      FOREIGN KEY (account_id) REFERENCES \`account\` (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
  `CREATE TABLE IF NOT EXISTS account_email_change_tokens (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    account_id INT UNSIGNED NOT NULL,
    pending_email VARCHAR(254) NOT NULL,
    token_hash BINARY(32) NOT NULL,
    expires_at DATETIME(3) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    consumed_at DATETIME(3) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_account_email_change_tokens_hash (token_hash),
    KEY idx_account_email_change_tokens_account (account_id),
    KEY idx_account_email_change_tokens_expiry (expires_at),
    CONSTRAINT fk_account_email_change_tokens_account
      FOREIGN KEY (account_id) REFERENCES \`account\` (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
  `CREATE TABLE IF NOT EXISTS account_password_reset_tokens (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    account_id INT UNSIGNED NOT NULL,
    token_hash BINARY(32) NOT NULL,
    expires_at DATETIME(3) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    consumed_at DATETIME(3) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_account_password_reset_tokens_hash (token_hash),
    KEY idx_account_password_reset_tokens_account (account_id),
    KEY idx_account_password_reset_tokens_expiry (expires_at),
    CONSTRAINT fk_account_password_reset_tokens_account
      FOREIGN KEY (account_id) REFERENCES \`account\` (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    account_id INT UNSIGNED NOT NULL,
    token_hash BINARY(32) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    last_activity_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    expires_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_sessions_token_hash (token_hash),
    KEY idx_sessions_account (account_id),
    KEY idx_sessions_expiry (expires_at),
    CONSTRAINT fk_sessions_account
      FOREIGN KEY (account_id) REFERENCES \`account\` (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
  `CREATE TABLE IF NOT EXISTS demo_instances (
    account_id INT UNSIGNED NOT NULL,
    expires_at DATETIME(3) NOT NULL,
    ended_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (account_id),
    KEY idx_demo_instances_expiry (expires_at),
    KEY idx_demo_instances_ended (ended_at),
    CONSTRAINT fk_demo_instances_account
      FOREIGN KEY (account_id) REFERENCES \`account\` (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
  `CREATE TABLE IF NOT EXISTS demo_start_attempts (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    ip_hash BINARY(32) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    KEY idx_demo_start_attempts_ip_time (ip_hash, created_at),
    KEY idx_demo_start_attempts_time (created_at)
  ) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
  `CREATE TABLE IF NOT EXISTS demo_start_requests (
    request_hash BINARY(32) NOT NULL,
    account_id INT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (request_hash),
    UNIQUE KEY uq_demo_start_requests_account (account_id),
    CONSTRAINT fk_demo_start_requests_account
      FOREIGN KEY (account_id) REFERENCES \`account\` (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
] as const
