import mysql from 'mysql2/promise';

const boolean = (value) => String(value).toLowerCase() === 'true';

export const pool = mysql.createPool({
  host: process.env.DATABASE_HOST || '127.0.0.1',
  port: Number(process.env.DATABASE_PORT || 3306),
  database: process.env.DATABASE_NAME || 'agencia_shein',
  user: process.env.DATABASE_USER || 'agencia_shein',
  password: process.env.DATABASE_PASSWORD || '',
  connectionLimit: 10,
  charset: 'utf8mb4',
  ssl: boolean(process.env.DATABASE_SSL) ? { rejectUnauthorized: true } : undefined
});

const migrations = [
  `CREATE TABLE IF NOT EXISTS schema_migrations (
    version INT PRIMARY KEY,
    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    habbo_id VARCHAR(64) NULL UNIQUE,
    username VARCHAR(32) NOT NULL UNIQUE,
    role ENUM('owner','admin','supervisor','member','pending') NOT NULL DEFAULT 'pending',
    status ENUM('active','away','inactive','pending','blocked') NOT NULL DEFAULT 'pending',
    department VARCHAR(80) NULL,
    last_activity_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_users_role_status (role, status),
    INDEX idx_users_activity (last_activity_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `CREATE TABLE IF NOT EXISTS auth_challenges (
    id CHAR(36) PRIMARY KEY,
    username VARCHAR(32) NOT NULL,
    code VARCHAR(32) NOT NULL,
    purpose ENUM('register','login') NOT NULL,
    expires_at DATETIME NOT NULL,
    attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
    verified_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_challenge_user (username, expires_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    token_hash CHAR(64) NOT NULL UNIQUE,
    expires_at DATETIME NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_sessions_expiry (expires_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `CREATE TABLE IF NOT EXISTS agency_settings (
    setting_key VARCHAR(80) PRIMARY KEY,
    setting_value JSON NOT NULL,
    updated_by BIGINT UNSIGNED NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_settings_user FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `CREATE TABLE IF NOT EXISTS audit_log (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    actor_id BIGINT UNSIGNED NULL,
    action VARCHAR(80) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id VARCHAR(80) NULL,
    metadata JSON NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_audit_actor FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_audit_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`
];

export async function migrate() {
  const connection = await pool.getConnection();
  try {
    for (let index = 0; index < migrations.length; index += 1) {
      const version = index + 1;
      const [rows] = await connection.query('SELECT version FROM schema_migrations WHERE version = ?', [version]).catch(() => [[]]);
      if (rows.length) continue;
      await connection.query(migrations[index]);
      if (version > 1) await connection.query('INSERT IGNORE INTO schema_migrations (version) VALUES (?)', [version]);
    }
    await connection.query('INSERT IGNORE INTO schema_migrations (version) VALUES (1)');
  } finally {
    connection.release();
  }
}

export async function seedOwner() {
  const username = (process.env.BOOTSTRAP_OWNER || '').trim();
  if (!username) return;
  await pool.execute(
    `INSERT INTO users (username, role, status, last_activity_at)
     VALUES (?, 'owner', 'active', NOW())
     ON DUPLICATE KEY UPDATE role = IF(role = 'pending', 'owner', role)`,
    [username]
  );
}

export async function audit(actorId, action, entityType, entityId = null, metadata = null) {
  await pool.execute(
    'INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata) VALUES (?, ?, ?, ?, ?)',
    [actorId || null, action, entityType, entityId, metadata ? JSON.stringify(metadata) : null]
  );
}
