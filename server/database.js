try { process.loadEnvFile(); } catch {}

import crypto from 'node:crypto';
import mysql from 'mysql2/promise';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `${salt}:${derivedKey.toString('hex')}`;
}

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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `ALTER TABLE users ADD COLUMN password_hash VARCHAR(255) NULL AFTER department`,
  `CREATE TABLE IF NOT EXISTS ranks (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    order_num INT NOT NULL UNIQUE,
    name VARCHAR(50) NOT NULL UNIQUE,
    badge_code VARCHAR(120) NOT NULL,
    badge_url VARCHAR(255) NOT NULL,
    pay_salary INT NOT NULL DEFAULT 0,
    pay_bonus INT NOT NULL DEFAULT 0,
    req_salary_attendance INT NOT NULL DEFAULT 0,
    req_salary_promotions INT NOT NULL DEFAULT 0,
    req_salary_time_hours INT NOT NULL DEFAULT 0,
    req_salary_signings INT NOT NULL DEFAULT 0,
    req_bonus_attendance INT NOT NULL DEFAULT 0,
    req_bonus_promotions INT NOT NULL DEFAULT 0,
    req_bonus_time_hours INT NOT NULL DEFAULT 0,
    req_bonus_signings INT NOT NULL DEFAULT 0,
    promotes_up_to VARCHAR(50) NULL,
    promotion_time_wait VARCHAR(50) NULL,
    transfer_price INT NOT NULL DEFAULT 0,
    transfer_available BOOLEAN NOT NULL DEFAULT FALSE,
    sales_commission_percent INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `CREATE TABLE IF NOT EXISTS missions_catalog (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    rank_id INT UNSIGNED NOT NULL,
    order_num INT NOT NULL,
    name VARCHAR(80) NOT NULL,
    price INT NOT NULL DEFAULT 0,
    sale_available BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_mission_rank FOREIGN KEY (rank_id) REFERENCES ranks(id) ON DELETE CASCADE,
    INDEX idx_mission_rank (rank_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `CREATE TABLE IF NOT EXISTS memberships_catalog (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    badge_code VARCHAR(120) NULL,
    badge_url VARCHAR(255) NULL,
    description VARCHAR(255) NOT NULL,
    price INT NOT NULL DEFAULT 0,
    reduction_percent INT NOT NULL DEFAULT 0,
    sale_available BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `ALTER TABLE users ADD COLUMN rank_id INT UNSIGNED NULL AFTER department, ADD COLUMN current_mission VARCHAR(120) NULL AFTER rank_id, ADD COLUMN last_promotion_at DATETIME NULL AFTER current_mission`,
  `CREATE TABLE IF NOT EXISTS timers (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    started_by BIGINT UNSIGNED NOT NULL,
    location VARCHAR(60) NOT NULL DEFAULT 'Base',
    status ENUM('active','paused','completed','cancelled') NOT NULL DEFAULT 'active',
    started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    paused_at DATETIME NULL,
    accumulated_seconds INT UNSIGNED NOT NULL DEFAULT 0,
    pause_count INT UNSIGNED NOT NULL DEFAULT 0,
    notes VARCHAR(255) NULL,
    completed_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_timers_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_timers_starter FOREIGN KEY (started_by) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_timers_status (status),
    INDEX idx_timers_user (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `CREATE TABLE IF NOT EXISTS attendance_sessions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    created_by BIGINT UNSIGNED NOT NULL,
    shift_name VARCHAR(100) NOT NULL,
    status ENUM('open','closed') NOT NULL DEFAULT 'open',
    opened_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at DATETIME NULL,
    notes VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_att_sessions_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_att_status (status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `CREATE TABLE IF NOT EXISTS attendance_records (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    session_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    status ENUM('present','absent','excused') NOT NULL DEFAULT 'present',
    marked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    marked_by BIGINT UNSIGNED NOT NULL,
    CONSTRAINT fk_att_records_session FOREIGN KEY (session_id) REFERENCES attendance_sessions(id) ON DELETE CASCADE,
    CONSTRAINT fk_att_records_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_att_records_marker FOREIGN KEY (marked_by) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY uq_session_user (session_id, user_id),
    INDEX idx_att_records_user (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `ALTER TABLE users
    ADD COLUMN accumulated_time_seconds INT UNSIGNED NOT NULL DEFAULT 0 AFTER current_mission,
    ADD COLUMN accumulated_attendances INT UNSIGNED NOT NULL DEFAULT 0 AFTER accumulated_time_seconds,
    ADD COLUMN accumulated_promotions INT UNSIGNED NOT NULL DEFAULT 0 AFTER accumulated_attendances`,
  `ALTER TABLE users ADD COLUMN membership_id INT UNSIGNED NULL AFTER rank_id`,
  `CREATE TABLE IF NOT EXISTS payroll_periods (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    period_code VARCHAR(64) NOT NULL UNIQUE,
    shift_name VARCHAR(100) NOT NULL,
    status ENUM('draft','closed','paid') NOT NULL DEFAULT 'draft',
    opened_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at DATETIME NULL,
    paid_at DATETIME NULL,
    processed_by BIGINT UNSIGNED NULL,
    total_evaluated INT UNSIGNED NOT NULL DEFAULT 0,
    total_nominal INT UNSIGNED NOT NULL DEFAULT 0,
    total_bonus INT UNSIGNED NOT NULL DEFAULT 0,
    total_review INT UNSIGNED NOT NULL DEFAULT 0,
    total_credits INT UNSIGNED NOT NULL DEFAULT 0,
    notes VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_payroll_processor FOREIGN KEY (processed_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_payroll_status (status),
    INDEX idx_payroll_date (opened_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `CREATE TABLE IF NOT EXISTS payroll_items (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    period_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    rank_id INT UNSIGNED NULL,
    qualification ENUM('bonus','nominal','review','none') NOT NULL DEFAULT 'nominal',
    level ENUM('high','low','none') NOT NULL DEFAULT 'low',
    attendance_count INT UNSIGNED NOT NULL DEFAULT 0,
    time_seconds INT UNSIGNED NOT NULL DEFAULT 0,
    promotions_count INT UNSIGNED NOT NULL DEFAULT 0,
    signings_count INT UNSIGNED NOT NULL DEFAULT 0,
    membership_id INT UNSIGNED NULL,
    discount_applied VARCHAR(80) NULL,
    credits_to_pay INT UNSIGNED NOT NULL DEFAULT 0,
    payment_status ENUM('pending','paid','saved','rejected') NOT NULL DEFAULT 'pending',
    override_by BIGINT UNSIGNED NULL,
    override_reason VARCHAR(255) NULL,
    notes VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_payroll_item_period FOREIGN KEY (period_id) REFERENCES payroll_periods(id) ON DELETE CASCADE,
    CONSTRAINT fk_payroll_item_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_payroll_item_rank FOREIGN KEY (rank_id) REFERENCES ranks(id) ON DELETE SET NULL,
    CONSTRAINT fk_payroll_item_membership FOREIGN KEY (membership_id) REFERENCES memberships_catalog(id) ON DELETE SET NULL,
    CONSTRAINT fk_payroll_item_override FOREIGN KEY (override_by) REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE KEY uq_payroll_period_user (period_id, user_id),
    INDEX idx_payroll_item_user (user_id),
    INDEX idx_payroll_item_qual (qualification)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `ALTER TABLE users ADD COLUMN membership_expires_at DATETIME NULL AFTER membership_id`,
  `CREATE TABLE IF NOT EXISTS commercial_operations (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    type ENUM('sale_membership','sale_rank','sale_mission','transfer','other') NOT NULL,
    user_id BIGINT UNSIGNED NULL,
    client_username VARCHAR(32) NOT NULL,
    concept VARCHAR(120) NOT NULL,
    credits INT NOT NULL DEFAULT 0,
    discount_percent INT NOT NULL DEFAULT 0,
    final_credits INT NOT NULL DEFAULT 0,
    status ENUM('completed','pending','cancelled') NOT NULL DEFAULT 'completed',
    origin_agency VARCHAR(80) NULL,
    target_rank_id INT UNSIGNED NULL,
    target_membership_id INT UNSIGNED NULL,
    seller_id BIGINT UNSIGNED NOT NULL,
    commission_credits INT NOT NULL DEFAULT 0,
    notes VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_com_op_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_com_op_seller FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_com_op_rank FOREIGN KEY (target_rank_id) REFERENCES ranks(id) ON DELETE SET NULL,
    CONSTRAINT fk_com_op_memb FOREIGN KEY (target_membership_id) REFERENCES memberships_catalog(id) ON DELETE SET NULL,
    INDEX idx_com_op_type (type),
    INDEX idx_com_op_status (status),
    INDEX idx_com_op_date (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `CREATE TABLE IF NOT EXISTS promotions_log (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    promoter_id BIGINT UNSIGNED NOT NULL,
    old_mission VARCHAR(120) NULL,
    new_mission VARCHAR(120) NOT NULL,
    old_rank_id INT UNSIGNED NULL,
    new_rank_id INT UNSIGNED NULL,
    type ENUM('earned','purchased','transfer','correction') NOT NULL DEFAULT 'earned',
    credits_paid INT NOT NULL DEFAULT 0,
    notes VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_promo_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_promo_promoter FOREIGN KEY (promoter_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_promo_old_rank FOREIGN KEY (old_rank_id) REFERENCES ranks(id) ON DELETE SET NULL,
    CONSTRAINT fk_promo_new_rank FOREIGN KEY (new_rank_id) REFERENCES ranks(id) ON DELETE SET NULL,
    INDEX idx_promo_user (user_id),
    INDEX idx_promo_date (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `CREATE TABLE IF NOT EXISTS disciplinary_records (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    type ENUM('fine', 'demotion', 'dismissal', 'clone') NOT NULL,
    target_username VARCHAR(32) NOT NULL,
    target_user_id BIGINT UNSIGNED NULL,
    reason VARCHAR(255) NOT NULL,
    credits INT NOT NULL DEFAULT 0,
    status ENUM('pending', 'applied', 'resolved', 'allowed', 'rejected') NOT NULL DEFAULT 'pending',
    moderator_id BIGINT UNSIGNED NOT NULL,
    evidence_url VARCHAR(255) NULL,
    notes VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_disc_target_user FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_disc_moderator FOREIGN KEY (moderator_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_disc_type (type),
    INDEX idx_disc_status (status),
    INDEX idx_disc_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `ALTER TABLE users ADD COLUMN birthday DATE NULL, ADD COLUMN custom_status VARCHAR(255) NULL`
];

async function ensureDatabase() {
  const dbName = process.env.DATABASE_NAME || 'agencia_shein';
  try {
    const tempConn = await mysql.createConnection({
      host: process.env.DATABASE_HOST || '127.0.0.1',
      port: Number(process.env.DATABASE_PORT || 3306),
      user: process.env.DATABASE_USER || 'agencia_shein',
      password: process.env.DATABASE_PASSWORD || '',
      ssl: boolean(process.env.DATABASE_SSL) ? { rejectUnauthorized: true } : undefined
    });
    await tempConn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    await tempConn.end();
  } catch {
    // Si el usuario no tiene permisos globales de CREATE DATABASE, se continúa para que el pool intente conectar directamente
  }
}

export async function migrate() {
  await ensureDatabase();
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

export const DEFAULT_RANKS = [
  {
    order_num: 1,
    name: 'Agente',
    badge_code: 'b22134s55117s02014s43114s7801448c50772a4dbd5048aa0d5f5ca9145bc',
    pay_salary: 0,
    pay_bonus: 0,
    req_salary_attendance: 0,
    req_salary_promotions: 0,
    req_salary_time_hours: 0,
    req_salary_signings: 0,
    req_bonus_attendance: 0,
    req_bonus_promotions: 0,
    req_bonus_time_hours: 0,
    req_bonus_signings: 0,
    promotes_up_to: null,
    promotion_time_wait: '30 Minutos',
    transfer_price: 0,
    transfer_available: false,
    sales_commission_percent: 0
  },
  {
    order_num: 2,
    name: 'Seguridad',
    badge_code: 'b22134s55117s02014s43114s960149afe35c449e214cc3017c43d71444b66',
    pay_salary: 11,
    pay_bonus: 11,
    req_salary_attendance: 5,
    req_salary_promotions: 0,
    req_salary_time_hours: 0,
    req_salary_signings: 0,
    req_bonus_attendance: 4,
    req_bonus_promotions: 0,
    req_bonus_time_hours: 0,
    req_bonus_signings: 0,
    promotes_up_to: null,
    promotion_time_wait: '4 Horas',
    transfer_price: 40,
    transfer_available: true,
    sales_commission_percent: 0
  },
  {
    order_num: 3,
    name: 'Técnico',
    badge_code: 'b22134s55117s02014s43114s97014e60cdd63281e1fc0bceeec3b778e5ddc',
    pay_salary: 11,
    pay_bonus: 15,
    req_salary_attendance: 6,
    req_salary_promotions: 0,
    req_salary_time_hours: 0,
    req_salary_signings: 0,
    req_bonus_attendance: 6,
    req_bonus_promotions: 0,
    req_bonus_time_hours: 0,
    req_bonus_signings: 0,
    promotes_up_to: null,
    promotion_time_wait: '10 Horas',
    transfer_price: 80,
    transfer_available: true,
    sales_commission_percent: 0
  },
  {
    order_num: 4,
    name: 'Logística',
    badge_code: 'b22134s55117s02014s43114s89014f46be14b6f978c21fdb2f7dd9defab59',
    pay_salary: 14,
    pay_bonus: 16,
    req_salary_attendance: 6,
    req_salary_promotions: 0,
    req_salary_time_hours: 0,
    req_salary_signings: 0,
    req_bonus_attendance: 7,
    req_bonus_promotions: 0,
    req_bonus_time_hours: 0,
    req_bonus_signings: 0,
    promotes_up_to: null,
    promotion_time_wait: '20 Horas',
    transfer_price: 110,
    transfer_available: true,
    sales_commission_percent: 0
  },
  {
    order_num: 5,
    name: 'Supervisor',
    badge_code: 'b22134s55117s02114s43114s96014cf03d0df1f1b714a1492dce4a2b2a2cb',
    pay_salary: 15,
    pay_bonus: 20,
    req_salary_attendance: 7,
    req_salary_promotions: 0,
    req_salary_time_hours: 0,
    req_salary_signings: 0,
    req_bonus_attendance: 0,
    req_bonus_promotions: 7,
    req_bonus_time_hours: 0,
    req_bonus_signings: 0,
    promotes_up_to: 'Supervisor',
    promotion_time_wait: '5 Días',
    transfer_price: 150,
    transfer_available: true,
    sales_commission_percent: 0
  },
  {
    order_num: 6,
    name: 'Director',
    badge_code: 'b22134s55117s02117s43114s8101454d4ccca397ac39091093d4379bc548f',
    pay_salary: 16,
    pay_bonus: 24,
    req_salary_attendance: 8,
    req_salary_promotions: 0,
    req_salary_time_hours: 0,
    req_salary_signings: 0,
    req_bonus_attendance: 0,
    req_bonus_promotions: 7,
    req_bonus_time_hours: 0,
    req_bonus_signings: 0,
    promotes_up_to: 'Supervisor',
    promotion_time_wait: '8 Días',
    transfer_price: 210,
    transfer_available: true,
    sales_commission_percent: 0
  },
  {
    order_num: 7,
    name: 'Presidente',
    badge_code: 'b22134s55117s02114s43114s93014adb6f1cee2b015e1ba431c44affd0195',
    pay_salary: 18,
    pay_bonus: 27,
    req_salary_attendance: 8,
    req_salary_promotions: 0,
    req_salary_time_hours: 0,
    req_salary_signings: 0,
    req_bonus_attendance: 0,
    req_bonus_promotions: 8,
    req_bonus_time_hours: 0,
    req_bonus_signings: 0,
    promotes_up_to: 'Director',
    promotion_time_wait: '9 Días',
    transfer_price: 270,
    transfer_available: true,
    sales_commission_percent: 0
  },
  {
    order_num: 8,
    name: 'Operativo',
    badge_code: 'b22134s55117s02224s43114s920140398647060925dcdd3ed401f671807ae',
    pay_salary: 20,
    pay_bonus: 35,
    req_salary_attendance: 0,
    req_salary_promotions: 0,
    req_salary_time_hours: 20,
    req_salary_signings: 0,
    req_bonus_attendance: 0,
    req_bonus_promotions: 0,
    req_bonus_time_hours: 28,
    req_bonus_signings: 0,
    promotes_up_to: 'Presidente',
    promotion_time_wait: '14 Días',
    transfer_price: 380,
    transfer_available: true,
    sales_commission_percent: 0
  },
  {
    order_num: 9,
    name: 'Junta Directiva',
    badge_code: 'b22134s55117s02221s43114s870148b3ac0ae8e99d75561c9ed3e69687286',
    pay_salary: 35,
    pay_bonus: 40,
    req_salary_attendance: 0,
    req_salary_promotions: 0,
    req_salary_time_hours: 32,
    req_salary_signings: 0,
    req_bonus_attendance: 0,
    req_bonus_promotions: 0,
    req_bonus_time_hours: 30,
    req_bonus_signings: 0,
    promotes_up_to: 'Presidente',
    promotion_time_wait: null,
    transfer_price: 610,
    transfer_available: true,
    sales_commission_percent: 0
  },
  {
    order_num: 10,
    name: 'Administrador',
    badge_code: 'b22134s55117s02093s43114s7801429cea900de22cfe09874dce3883564cf',
    pay_salary: 0,
    pay_bonus: 0,
    req_salary_attendance: 0,
    req_salary_promotions: 0,
    req_salary_time_hours: 0,
    req_salary_signings: 0,
    req_bonus_attendance: 0,
    req_bonus_promotions: 0,
    req_bonus_time_hours: 0,
    req_bonus_signings: 0,
    promotes_up_to: 'Junta Directiva',
    promotion_time_wait: null,
    transfer_price: 0,
    transfer_available: false,
    sales_commission_percent: 40
  },
  {
    order_num: 11,
    name: 'Manager',
    badge_code: 'b22134s55117s02094s43114s9001407db05c225533313f696ec043c63f56f',
    pay_salary: 0,
    pay_bonus: 0,
    req_salary_attendance: 0,
    req_salary_promotions: 0,
    req_salary_time_hours: 0,
    req_salary_signings: 0,
    req_bonus_attendance: 0,
    req_bonus_promotions: 0,
    req_bonus_time_hours: 0,
    req_bonus_signings: 0,
    promotes_up_to: 'Junta Directiva',
    promotion_time_wait: null,
    transfer_price: 0,
    transfer_available: false,
    sales_commission_percent: 50
  },
  {
    order_num: 12,
    name: 'Founder',
    badge_code: 'b22134s55117s02244s43114s830145d45e67e7b6c663ec90a1a27ffa859bc',
    pay_salary: 0,
    pay_bonus: 0,
    req_salary_attendance: 0,
    req_salary_promotions: 0,
    req_salary_time_hours: 0,
    req_salary_signings: 0,
    req_bonus_attendance: 0,
    req_bonus_promotions: 0,
    req_bonus_time_hours: 0,
    req_bonus_signings: 0,
    promotes_up_to: 'Junta Directiva',
    promotion_time_wait: null,
    transfer_price: 0,
    transfer_available: false,
    sales_commission_percent: 75
  },
  {
    order_num: 13,
    name: 'Dueño',
    badge_code: 'b22244s55117s02244s43114s81014509ccf435988bb7258a87140f58ec20c',
    pay_salary: 0,
    pay_bonus: 0,
    req_salary_attendance: 0,
    req_salary_promotions: 0,
    req_salary_time_hours: 0,
    req_salary_signings: 0,
    req_bonus_attendance: 0,
    req_bonus_promotions: 0,
    req_bonus_time_hours: 0,
    req_bonus_signings: 0,
    promotes_up_to: 'Dueño',
    promotion_time_wait: null,
    transfer_price: 0,
    transfer_available: false,
    sales_commission_percent: 0
  }
];

export const DEFAULT_MEMBERSHIPS = [
  { name: 'COMANDOS EXTRA', badge_code: 'b22014t23244s39012t31016t400180e8b22b82eff27ac3272a13cb0e65959', description: 'Usa comandos exclusivos.', price: 10, reduction_percent: 0, sale_available: true },
  { name: 'REGLA LIBRE', badge_code: 'b22134t42134t31136s95113s8911559f7ee36fae2a4cb1c52555b70b62e0f', description: 'Ropa libre y Bailar', price: 25, reduction_percent: 0, sale_available: true },
  { name: 'VIP', badge_code: 'b22134s14014s02114s43134t5513491106feec881be578060ce26e1654e17', description: 'Acceso a base y sus juegos.', price: 30, reduction_percent: 0, sale_available: true },
  { name: 'FILA VIP', badge_code: 'b22014s99138t31016t55014s83130b02d3b3f336e4552bfa9fc69ccf0e5b4', description: 'Acceso prioritario a fila de pagas.', price: 20, reduction_percent: 0, sale_available: true },
  { name: 'BRONCE', badge_code: 'b22144s01141s43114s79144t311463813af0cf9b10e42e9f5c3b9da26b996', description: 'Regla libre y fila VIP', price: 35, reduction_percent: 0, sale_available: true },
  { name: 'SILVER', badge_code: 'b22244s01244s43114s96114t312465bfc520e10173bf8bb192ac7f09d49ad', description: 'Igual que bronce + reducción.', price: 55, reduction_percent: 50, sale_available: true },
  { name: 'GOLD', badge_code: 'b22014s01014s43114s84114t3101659b23d986ed75f80db552488dfd30962', description: 'Igual que bronce y silver + guarda paga', price: 65, reduction_percent: 50, sale_available: true },
  { name: 'GUARDA PAGA', badge_code: 'b22014s29012s22014s93018s84010e6ff327ba58b83b1744a3274497ffac5', description: 'Guarda Paga hasta 48h.', price: 25, reduction_percent: 0, sale_available: true },
  { name: 'AFK', badge_code: null, description: 'Permite estar AUS en los pases de lista.', price: 65, reduction_percent: 0, sale_available: true },
  { name: 'REDUCCIÓN', badge_code: 'b22014s42014s95014t50011t3101659f65203ac8cf0abec30429c25635c75', description: 'Reduce requisitos a la mitad.', price: 30, reduction_percent: 50, sale_available: true }
];

export const OFFICIAL_RANK_MISSIONS = [
  // 1. Agente (AGT) - 5 niveles (No disponible para venta directa)
  {
    rank: 'Agente',
    prefix: 'AGT',
    sale_available: false,
    missions: [
      { name: 'AGT- Iniciado J', price: 0 },
      { name: 'AGT- Novato H', price: 0 },
      { name: 'AGT- Auxiliar G', price: 0 },
      { name: 'AGT- Ayudante F', price: 0 },
      { name: 'AGT- Junior E', price: 0 }
    ]
  },
  // 2. Seguridad (SEG) - 10 niveles
  {
    rank: 'Seguridad',
    prefix: 'SEG',
    sale_available: true,
    missions: [
      { name: 'SEG- Iniciado J', price: 13 },
      { name: 'SEG- Bajo I', price: 15 },
      { name: 'SEG- Novato H', price: 17 },
      { name: 'SEG- Auxiliar G', price: 19 },
      { name: 'SEG- Ayudante F', price: 21 },
      { name: 'SEG- Junior E', price: 23 },
      { name: 'SEG- Intermedio D', price: 25 },
      { name: 'SEG- Avanzado C', price: 27 },
      { name: 'SEG- Experto B', price: 29 },
      { name: 'SEG- Jef A', price: 31 }
    ]
  },
  // 3. Técnico (TEC) - 10 niveles
  {
    rank: 'Técnico',
    prefix: 'TEC',
    sale_available: true,
    missions: [
      { name: 'TEC- Iniciado J', price: 35 },
      { name: 'TEC- Bajo I', price: 40 },
      { name: 'TEC- Novato H', price: 45 },
      { name: 'TEC- Auxiliar G', price: 50 },
      { name: 'TEC- Ayudante F', price: 55 },
      { name: 'TEC- Junior E', price: 60 },
      { name: 'TEC- Intermedio D', price: 65 },
      { name: 'TEC- Avanzado C', price: 70 },
      { name: 'TEC- Experto B', price: 75 },
      { name: 'TEC- Jef A', price: 80 }
    ]
  },
  // 4. Logística (LOG) - 10 niveles
  {
    rank: 'Logística',
    prefix: 'LOG',
    sale_available: true,
    missions: [
      { name: 'LOG- Iniciado J', price: 100 },
      { name: 'LOG- Bajo I', price: 120 },
      { name: 'LOG- Novato H', price: 140 },
      { name: 'LOG- Auxiliar G', price: 160 },
      { name: 'LOG- Ayudante F', price: 180 },
      { name: 'LOG- Junior E', price: 200 },
      { name: 'LOG- Intermedio D', price: 220 },
      { name: 'LOG- Avanzado C', price: 240 },
      { name: 'LOG- Experto B', price: 260 },
      { name: 'LOG- Jef A', price: 280 }
    ]
  },
  // 5. Supervisor (SUP) - 10 niveles
  {
    rank: 'Supervisor',
    prefix: 'SUP',
    sale_available: true,
    missions: [
      { name: 'SUP- Iniciado J', price: 350 },
      { name: 'SUP- Bajo I', price: 400 },
      { name: 'SUP- Novato H', price: 450 },
      { name: 'SUP- Auxiliar G', price: 500 },
      { name: 'SUP- Ayudante F', price: 550 },
      { name: 'SUP- Junior E', price: 600 },
      { name: 'SUP- Intermedio D', price: 650 },
      { name: 'SUP- Avanzado C', price: 700 },
      { name: 'SUP- Experto B', price: 750 },
      { name: 'SUP- Jef A', price: 800 }
    ]
  },
  // 6. Director (DIR) - 10 niveles
  {
    rank: 'Director',
    prefix: 'DIR',
    sale_available: true,
    missions: [
      { name: 'DIR- Iniciado J', price: 820 },
      { name: 'DIR- Bajo I', price: 840 },
      { name: 'DIR- Novato H', price: 860 },
      { name: 'DIR- Auxiliar G', price: 880 },
      { name: 'DIR- Ayudante F', price: 900 },
      { name: 'DIR- Junior E', price: 920 },
      { name: 'DIR- Intermedio D', price: 940 },
      { name: 'DIR- Avanzado C', price: 960 },
      { name: 'DIR- Experto B', price: 980 },
      { name: 'DIR- Jef A', price: 1000 }
    ]
  },
  // 7. Presidente (PRE) - 10 niveles
  {
    rank: 'Presidente',
    prefix: 'PRE',
    sale_available: true,
    missions: [
      { name: 'PRE- Iniciado J', price: 1040 },
      { name: 'PRE- Bajo I', price: 1080 },
      { name: 'PRE- Novato H', price: 1120 },
      { name: 'PRE- Auxiliar G', price: 1160 },
      { name: 'PRE- Ayudante F', price: 1200 },
      { name: 'PRE- Junior E', price: 1240 },
      { name: 'PRE- Intermedio D', price: 1280 },
      { name: 'PRE- Avanzado C', price: 1320 },
      { name: 'PRE- Experto B', price: 1360 },
      { name: 'PRE- Jef A', price: 1400 }
    ]
  },
  // 8. Operativo (OPE) - 10 niveles
  {
    rank: 'Operativo',
    prefix: 'OPE',
    sale_available: true,
    missions: [
      { name: 'OPE- Iniciado J', price: 1500 },
      { name: 'OPE- Bajo I', price: 1600 },
      { name: 'OPE- Novato H', price: 1700 },
      { name: 'OPE- Auxiliar G', price: 1800 },
      { name: 'OPE- Ayudante F', price: 1900 },
      { name: 'OPE- Junior E', price: 2000 },
      { name: 'OPE- Intermedio D', price: 2100 },
      { name: 'OPE- Avanzado C', price: 2200 },
      { name: 'OPE- Experto B', price: 2300 },
      { name: 'OPE- Jef A', price: 2400 }
    ]
  },
  // 9. Junta Directiva (JDT) - 10 niveles (No disponible para venta directa)
  {
    rank: 'Junta Directiva',
    prefix: 'JDT',
    sale_available: false,
    missions: [
      { name: 'JDT- Iniciado J', price: 0 },
      { name: 'JDT- Bajo I', price: 0 },
      { name: 'JDT- Novato H', price: 0 },
      { name: 'JDT- Auxiliar G', price: 0 },
      { name: 'JDT- Ayudante F', price: 0 },
      { name: 'JDT- Junior E', price: 0 },
      { name: 'JDT- Intermedio D', price: 0 },
      { name: 'JDT- Avanzado C', price: 0 },
      { name: 'JDT- Experto B', price: 0 },
      { name: 'JDT- Jef A', price: 0 }
    ]
  }
];

export async function seedRanksAndCatalogs() {
  for (const rank of DEFAULT_RANKS) {
    const badgeUrl = `https://www.habbo.es/habbo-imaging/badge/${rank.badge_code}.gif`;
    await pool.execute(
      `INSERT INTO ranks (
        order_num, name, badge_code, badge_url, pay_salary, pay_bonus,
        req_salary_attendance, req_salary_promotions, req_salary_time_hours, req_salary_signings,
        req_bonus_attendance, req_bonus_promotions, req_bonus_time_hours, req_bonus_signings,
        promotes_up_to, promotion_time_wait, transfer_price, transfer_available, sales_commission_percent
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        badge_code = VALUES(badge_code),
        badge_url = VALUES(badge_url),
        pay_salary = VALUES(pay_salary),
        pay_bonus = VALUES(pay_bonus),
        req_salary_attendance = VALUES(req_salary_attendance),
        req_salary_promotions = VALUES(req_salary_promotions),
        req_salary_time_hours = VALUES(req_salary_time_hours),
        req_bonus_attendance = VALUES(req_bonus_attendance),
        req_bonus_promotions = VALUES(req_bonus_promotions),
        req_bonus_time_hours = VALUES(req_bonus_time_hours),
        promotes_up_to = VALUES(promotes_up_to),
        promotion_time_wait = VALUES(promotion_time_wait),
        transfer_price = VALUES(transfer_price),
        transfer_available = VALUES(transfer_available),
        sales_commission_percent = VALUES(sales_commission_percent)`,
      [
        rank.order_num, rank.name, rank.badge_code, badgeUrl, rank.pay_salary, rank.pay_bonus,
        rank.req_salary_attendance, rank.req_salary_promotions, rank.req_salary_time_hours, rank.req_salary_signings,
        rank.req_bonus_attendance, rank.req_bonus_promotions, rank.req_bonus_time_hours, rank.req_bonus_signings,
        rank.promotes_up_to, rank.promotion_time_wait, rank.transfer_price, rank.transfer_available ? 1 : 0, rank.sales_commission_percent
      ]
    );
  }

  for (const m of DEFAULT_MEMBERSHIPS) {
    const badgeUrl = m.badge_code ? `https://www.habbo.es/habbo-imaging/badge/${m.badge_code}.gif` : null;
    await pool.execute(
      `INSERT INTO memberships_catalog (name, badge_code, badge_url, description, price, reduction_percent, sale_available)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         badge_code = VALUES(badge_code),
         badge_url = VALUES(badge_url),
         description = VALUES(description),
         price = VALUES(price),
         reduction_percent = VALUES(reduction_percent),
         sale_available = VALUES(sale_available)`,
      [m.name, m.badge_code, badgeUrl, m.description, m.price, m.reduction_percent, m.sale_available ? 1 : 0]
    );
  }

  // Seed official subdivisions/missions for the 9 hierarchical ranks
  for (const group of OFFICIAL_RANK_MISSIONS) {
    const [[rankRow]] = await pool.execute('SELECT id FROM ranks WHERE name = ? LIMIT 1', [group.rank]);
    if (!rankRow) continue;

    // Delete existing missions for this rank to ensure clean catalog with exact 85 missions
    await pool.execute('DELETE FROM missions_catalog WHERE rank_id = ?', [rankRow.id]);

    for (let i = 0; i < group.missions.length; i++) {
      const m = group.missions[i];
      await pool.execute(
        'INSERT INTO missions_catalog (rank_id, order_num, name, price, sale_available) VALUES (?, ?, ?, ?, ?)',
        [rankRow.id, i + 1, m.name, m.price, group.sale_available ? 1 : 0]
      );
    }
  }

  // Update owners with Dueño rank and mission
  const [[duenoRank]] = await pool.execute("SELECT id FROM ranks WHERE name = 'Dueño' LIMIT 1");
  if (duenoRank) {
    const owners = (process.env.BOOTSTRAP_OWNER || '').split(',').map((u) => u.trim()).filter(Boolean);
    for (const ownerName of owners) {
      await pool.execute(
        "UPDATE users SET rank_id = ?, current_mission = 'SHN · Dueño · KEK · GUS' WHERE username = ? AND (rank_id IS NULL OR current_mission IS NULL)",
        [duenoRank.id, ownerName]
      );
    }
  }
}

export async function seedInitialAgencyActivity() {
  const [[existingUsersCount]] = await pool.query('SELECT COUNT(*) AS total FROM users');
  if (existingUsersCount.total <= 2) {
    const demoMembers = [
      { username: 'Jo.C', role: 'admin', rank: 'Administrador', dept: 'Gestión de Tiempos', mission: 'SHN · ADM · Jefe A [KEK/GUS]', att: 18, time: 36000, promo: 4 },
      { username: 'MitsunoNakae087', role: 'owner', rank: 'Dueño', dept: 'Marketing', mission: 'SHN · Dueño · KEK · GUS', att: 25, time: 45000, promo: 6 },
      { username: 'RosalBoy', role: 'admin', rank: 'Founder', dept: 'Juegos y Eventos', mission: 'SHN · FOU · Coordinador [KEK]', att: 22, time: 32000, promo: 5 },
      { username: 'R3belde', role: 'supervisor', rank: 'Supervisor', dept: 'Recursos Humanos', mission: 'SHN · SUP · Ayudante F [KEK]', att: 32, time: 17400, promo: 2 },
      { username: 'melany1999', role: 'member', rank: 'Operativo', dept: 'Operaciones', mission: 'SHN · OPE · Iniciado J [GUS]', att: 44, time: 124020, promo: 4 },
      { username: 'Ailin:0', role: 'member', rank: 'Operativo', dept: 'Operaciones', mission: 'SHN · OPE · Intermedio D [KEK]', att: 38, time: 183060, promo: 3 },
      { username: 'SaulSoprano', role: 'member', rank: 'Operativo', dept: 'Seguridad y Base', mission: 'SHN · OPE · Experto B [GUS]', att: 29, time: 450060, promo: 5 },
      { username: 'Berna.', role: 'supervisor', rank: 'Director', dept: 'Supervisión General', mission: 'SHN · DIR · Iniciado J [KEK]', att: 35, time: 365220, promo: 4 },
      { username: '4karen', role: 'supervisor', rank: 'Supervisor', dept: 'Supervisión General', mission: 'SHN · SUP · Novato H [KEK]', att: 51, time: 182220, promo: 3 },
      { username: 'Santig.f', role: 'supervisor', rank: 'Supervisor', dept: 'Supervisión General', mission: 'SHN · SUP · Junior E [KEK]', att: 46, time: 165660, promo: 2 },
      { username: 'elmodeloaseguir', role: 'supervisor', rank: 'Supervisor', dept: 'Supervisión General', mission: 'SHN · SUP · Iniciado J [KEK]', att: 41, time: 148380, promo: 1 },
      { username: 'pgg-Pedro', role: 'member', rank: 'Director', dept: 'Operaciones', mission: 'SHN · DIR · Ayudante F [KEK]', att: 20, time: 72000, promo: 2 },
      { username: 'AxelHabbo', role: 'member', rank: 'Agente', dept: 'Base', mission: 'SHN · AGT · Iniciado J [KEK]', att: 5, time: 18000, promo: 0 }
    ];

    for (const m of demoMembers) {
      const [[rankRow]] = await pool.execute('SELECT id FROM ranks WHERE name = ? LIMIT 1', [m.rank]);
      await pool.execute(
        `INSERT INTO users (username, role, status, department, rank_id, current_mission,
                            accumulated_attendances, accumulated_time_seconds, accumulated_promotions, last_activity_at)
         VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE rank_id = COALESCE(rank_id, VALUES(rank_id)),
           current_mission = COALESCE(current_mission, VALUES(current_mission)),
           department = COALESCE(department, VALUES(department)),
           accumulated_attendances = VALUES(accumulated_attendances),
           accumulated_time_seconds = VALUES(accumulated_time_seconds),
           accumulated_promotions = VALUES(accumulated_promotions)`,
        [m.username, m.role, m.dept, rankRow?.id || null, m.mission, m.att, m.time, m.promo]
      );
    }
  }

  // Seed active timers if empty
  const [[timerCount]] = await pool.query('SELECT COUNT(*) AS total FROM timers WHERE status IN ("active", "paused")');
  if (timerCount.total === 0) {
    const [[starter]] = await pool.query('SELECT id FROM users WHERE username = "Gusgus95MX" LIMIT 1');
    const [[userMelany]] = await pool.query('SELECT id FROM users WHERE username = "melany1999" LIMIT 1');
    const starterId = starter ? starter.id : 1;

    if (starter) {
      // Live timer: 7m 39s ago
      await pool.execute(
        `INSERT INTO timers (user_id, started_by, location, status, started_at, accumulated_seconds, pause_count)
         VALUES (?, ?, 'Base', 'active', DATE_SUB(NOW(), INTERVAL 459 SECOND), 459, 0)`,
        [starterId, starterId]
      );
    }

    if (userMelany) {
      // Paused timer: 4m 55s (295s), 1 pause
      await pool.execute(
        `INSERT INTO timers (user_id, started_by, location, status, started_at, paused_at, accumulated_seconds, pause_count)
         VALUES (?, ?, 'Entrenamiento', 'paused', DATE_SUB(NOW(), INTERVAL 600 SECOND), NOW(), 295, 1)`,
        [userMelany.id, starterId]
      );
    }
  }

  // Seed active attendance session if empty
  const [[openSessionCount]] = await pool.query('SELECT COUNT(*) AS total FROM attendance_sessions WHERE status = "open"');
  if (openSessionCount.total === 0) {
    const [[starter]] = await pool.query('SELECT id FROM users WHERE username = "Jo.C" LIMIT 1');
    const [[owner]] = await pool.query('SELECT id FROM users WHERE username = "keekit08" LIMIT 1');
    const starterId = starter ? starter.id : 1;

    const [sessionResult] = await pool.execute(
      `INSERT INTO attendance_sessions (created_by, shift_name, status, opened_at, notes)
       VALUES (?, 'Turno noche · 22:00', 'open', DATE_SUB(NOW(), INTERVAL 18 MINUTE), 'Pase diario España')`,
      [starterId]
    );

    const sessionId = sessionResult.insertId;
    if (sessionId) {
      const [members] = await pool.query('SELECT id FROM users WHERE status = "active" LIMIT 10');
      for (let i = 0; i < members.length; i++) {
        // Mark first 8 present, others absent
        const status = i < 8 ? 'present' : 'absent';
        await pool.execute(
          `INSERT INTO attendance_records (session_id, user_id, status, marked_at, marked_by)
           VALUES (?, ?, ?, NOW(), ?)`,
          [sessionId, members[i].id, status, starterId]
        );
      }
    }
  }

  // Assign memberships to demo members
  const [[silverM]] = await pool.query('SELECT id FROM memberships_catalog WHERE name = "SILVER" LIMIT 1');
  const [[reducM]] = await pool.query('SELECT id FROM memberships_catalog WHERE name = "REDUCCIÓN" LIMIT 1');
  const [[goldM]] = await pool.query('SELECT id FROM memberships_catalog WHERE name = "GOLD" LIMIT 1');
  const [[guardaM]] = await pool.query('SELECT id FROM memberships_catalog WHERE name = "GUARDA PAGA" LIMIT 1');

  if (silverM) await pool.execute('UPDATE users SET membership_id = ?, membership_expires_at = DATE_ADD(NOW(), INTERVAL 28 DAY) WHERE username = "Berna."', [silverM.id]);
  if (reducM) await pool.execute('UPDATE users SET membership_id = ?, membership_expires_at = DATE_ADD(NOW(), INTERVAL 25 DAY) WHERE username = "melany1999"', [reducM.id]);
  if (goldM) await pool.execute('UPDATE users SET membership_id = ?, membership_expires_at = DATE_ADD(NOW(), INTERVAL 22 DAY) WHERE username = "Ailin:0"', [goldM.id]);
  if (guardaM) await pool.execute('UPDATE users SET membership_id = ?, membership_expires_at = DATE_ADD(NOW(), INTERVAL 14 DAY) WHERE username = "4karen"', [guardaM.id]);

  // Seed commercial operations if empty
  const [[opsCount]] = await pool.query('SELECT COUNT(*) AS total FROM commercial_operations');
  if (opsCount.total === 0) {
    const [[keekit]] = await pool.query('SELECT id FROM users WHERE username = "keekit08" LIMIT 1');
    const [[joc]] = await pool.query('SELECT id FROM users WHERE username = "Jo.C" LIMIT 1');
    const [[userBerna]] = await pool.query('SELECT id FROM users WHERE username = "Berna." LIMIT 1');
    const [[userMelany]] = await pool.query('SELECT id FROM users WHERE username = "melany1999" LIMIT 1');
    const [[userKaren]] = await pool.query('SELECT id FROM users WHERE username = "4karen" LIMIT 1');
    const [[userAilin]] = await pool.query('SELECT id FROM users WHERE username = "Ailin:0" LIMIT 1');
    const [[userSaul]] = await pool.query('SELECT id FROM users WHERE username = "SaulSoprano" LIMIT 1');
    const sellerId = keekit ? keekit.id : 1;
    const jocId = joc ? joc.id : sellerId;

    const initialSales = [
      { type: 'sale_membership', userId: userBerna?.id, client: 'Berna.', concept: 'Silver', credits: 39, final: 39, status: 'pending', seller: sellerId, notes: 'Pendiente de cobro en sala' },
      { type: 'sale_membership', userId: userMelany?.id, client: 'melany1999', concept: 'Reducción', credits: 30, final: 30, status: 'completed', seller: sellerId, notes: 'Cobrado con éxito' },
      { type: 'sale_membership', userId: userKaren?.id, client: '4karen', concept: 'Guarda paga', credits: 25, final: 25, status: 'completed', seller: sellerId, notes: 'Cobrado con éxito' },
      { type: 'sale_membership', userId: userAilin?.id, client: 'Ailin:0', concept: 'Gold', credits: 65, final: 65, status: 'completed', seller: sellerId, notes: 'Membresía anual activa' },
      { type: 'sale_mission', userId: userSaul?.id, client: 'SaulSoprano', concept: 'OPE · Iniciado J', credits: 380, final: 380, status: 'completed', seller: jocId, notes: 'Ascenso directo comprado' }
    ];

    for (const s of initialSales) {
      await pool.execute(
        `INSERT INTO commercial_operations (type, user_id, client_username, concept, credits, final_credits, status, seller_id, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, DATE_SUB(NOW(), INTERVAL 2 DAY))`,
        [s.type, s.userId || null, s.client, s.concept, s.credits, s.final, s.status, s.seller, s.notes]
      );
    }

    const initialTransfers = [
      { client: ':Mariee!_', agency: 'Orion', concept: 'PRE · Iniciado', credits: 0, status: 'completed', seller: sellerId },
      { client: 'elmodeloaseguir', agency: 'Elite', concept: 'SUP · Iniciado', credits: 40, status: 'completed', seller: sellerId },
      { client: 'Renzz', agency: 'Hospital', concept: 'TEC · Iniciado', credits: 35, status: 'completed', seller: jocId }
    ];

    for (const t of initialTransfers) {
      await pool.execute(
        `INSERT INTO commercial_operations (type, client_username, origin_agency, concept, credits, final_credits, status, seller_id, notes, created_at)
         VALUES ('transfer', ?, ?, ?, ?, ?, ?, ?, 'Traslado de agencia convalidado', DATE_SUB(NOW(), INTERVAL 1 DAY))`,
        [t.client, t.agency, t.concept, t.credits, t.credits, t.status, t.seller]
      );
    }
  }

  // Seed promotions log if empty
  const [[promoLogCount]] = await pool.query('SELECT COUNT(*) AS total FROM promotions_log').catch(() => [[{ total: 0 }]]);
  if (promoLogCount && promoLogCount.total === 0) {
    const [[keekit]] = await pool.query('SELECT id FROM users WHERE username = "keekit08" LIMIT 1');
    const [[joc]] = await pool.query('SELECT id FROM users WHERE username = "Jo.C" LIMIT 1');
    const [[r3belde]] = await pool.query('SELECT id FROM users WHERE username = "R3belde" LIMIT 1');
    const [[ailin]] = await pool.query('SELECT id FROM users WHERE username = "Ailin:0" LIMIT 1');
    const [[saul]] = await pool.query('SELECT id FROM users WHERE username = "SaulSoprano" LIMIT 1');
    const [[berna]] = await pool.query('SELECT id FROM users WHERE username = "Berna." LIMIT 1');
    const promoterId = keekit ? keekit.id : 1;
    const jocId = joc ? joc.id : promoterId;

    const initialPromotions = [
      { userId: r3belde?.id, oldM: 'SUP · Ayudante F', newM: 'DIR · Iniciado J', type: 'earned', promoter: promoterId, credits: 0, date: '2026-09-26 21:42:00' },
      { userId: ailin?.id, oldM: 'SUP · Novato H', newM: 'SUP · Intermedio D', type: 'purchased', promoter: promoterId, credits: 240, date: '2026-09-25 18:20:00' },
      { userId: saul?.id, oldM: 'PRE · Jefe A', newM: 'OPE · Iniciado J', type: 'purchased', promoter: jocId, credits: 380, date: '2026-09-24 16:15:00' },
      { userId: berna?.id, oldM: 'SUP · Jefe A', newM: 'DIR · Iniciado J', type: 'earned', promoter: promoterId, credits: 0, date: '2026-09-23 20:30:00' }
    ];

    for (const p of initialPromotions) {
      if (!p.userId) continue;
      await pool.execute(
        `INSERT INTO promotions_log (user_id, promoter_id, old_mission, new_mission, type, credits_paid, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'Ascenso verificado por dirección', ?)`,
        [p.userId, p.promoter, p.oldM, p.newM, p.type, p.credits, p.date]
      );
    }
  }

  // Seed disciplinary records if empty
  const [[discLogCount]] = await pool.query('SELECT COUNT(*) AS total FROM disciplinary_records').catch(() => [[{ total: 0 }]]);
  if (discLogCount && discLogCount.total === 0) {
    const [[keekit]] = await pool.query('SELECT id FROM users WHERE username = "keekit08" LIMIT 1');
    const [[joc]] = await pool.query('SELECT id FROM users WHERE username = "Jo.C" LIMIT 1');
    const modKeekit = keekit ? keekit.id : 1;
    const modJoc = joc ? joc.id : modKeekit;

    const initialCases = [
      { type: 'fine', user: '-spcy', credits: 10, reason: 'Comentarios inadecuados', status: 'pending', mod: modJoc, date: '2026-09-15 14:30:00' },
      { type: 'demotion', user: 'pgg-Pedro', credits: 0, reason: 'Clon en otra agencia', status: 'applied', mod: modKeekit, date: '2026-09-10 18:20:00' },
      { type: 'dismissal', user: 'ChanelStyles', credits: 0, reason: 'Marcharse sin avisar', status: 'applied', mod: modJoc, date: '2026-09-06 20:10:00' },
      { type: 'clone', user: 'melany1999', credits: 0, reason: 'Usuario autorizado como cuenta secundaria', status: 'allowed', mod: modKeekit, date: '2026-09-02 12:00:00' },
      { type: 'fine', user: 'D4v1d_', credits: 15, reason: 'Ausencia injustificada en pase de lista', status: 'pending', mod: modKeekit, date: '2026-09-18 21:00:00' },
      { type: 'fine', user: 'Xx_Alex_xX', credits: 20, reason: 'Spam de comandos en sala de control', status: 'resolved', mod: modJoc, date: '2026-09-20 19:15:00' },
      { type: 'fine', user: 'LoboFeroz', credits: 10, reason: 'Vestimenta inadecuada en horario de atención', status: 'pending', mod: modJoc, date: '2026-09-22 17:40:00' },
      { type: 'demotion', user: 'TheRock99', credits: 0, reason: 'Incumplimiento reiterado de órdenes de seguridad', status: 'applied', mod: modJoc, date: '2026-09-12 16:45:00' },
      { type: 'demotion', user: 'Berna.', credits: 0, reason: 'Falta disciplinaria leve conmutada a degrado', status: 'applied', mod: modKeekit, date: '2026-09-08 19:30:00' },
      { type: 'dismissal', user: 'Habb0Player', credits: 0, reason: 'Faltas graves de respeto a usuarios en base', status: 'applied', mod: modKeekit, date: '2026-09-04 11:30:00' }
    ];

    for (const c of initialCases) {
      const [[target]] = await pool.query('SELECT id FROM users WHERE username = ? LIMIT 1', [c.user]).catch(() => [[]]);
      await pool.execute(
        `INSERT INTO disciplinary_records (type, target_username, target_user_id, reason, credits, status, moderator_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [c.type, c.user, target ? target.id : null, c.reason, c.credits, c.status, c.mod, c.date]
      );
    }
  }

  // Seed historical paid payroll periods (from live screenshot data)
  const [[histPeriodsCount]] = await pool.query('SELECT COUNT(*) AS total FROM payroll_periods WHERE status = "paid"');
  if (histPeriodsCount.total < 3) {
    const [[processor]] = await pool.query('SELECT id FROM users WHERE username = "Jo.C" LIMIT 1');
    const procId = processor ? processor.id : 1;

    const historical = [
      { code: '2026-09-25-noche', shift: 'Noche · España', date: '2026-09-25 22:03:00', members: 176, credits: 1760, nominal: 110, bonus: 59, review: 7 },
      { code: '2026-09-24-noche', shift: 'Noche · España', date: '2026-09-24 22:00:00', members: 182, credits: 1820, nominal: 115, bonus: 60, review: 7 },
      { code: '2026-09-23-noche', shift: 'Noche · España', date: '2026-09-23 22:00:00', members: 169, credits: 1690, nominal: 105, bonus: 56, review: 8 }
    ];

    for (const h of historical) {
      await pool.execute(
        `INSERT INTO payroll_periods (period_code, shift_name, status, opened_at, closed_at, paid_at, processed_by,
                                      total_evaluated, total_nominal, total_bonus, total_review, total_credits, notes)
         VALUES (?, ?, 'paid', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Cierre oficial verificado')
         ON DUPLICATE KEY UPDATE total_credits = VALUES(total_credits)`,
        [h.code, h.shift, h.date, h.date, h.date, procId, h.members, h.nominal, h.bonus, h.review, h.credits]
      );
    }
  }

  // Seed active draft payroll period and items
  const [[draftCount]] = await pool.query('SELECT COUNT(*) AS total FROM payroll_periods WHERE status = "draft"');
  if (draftCount.total === 0) {
    const todayCode = '2026-10-04-noche';
    const [periodRes] = await pool.execute(
      `INSERT INTO payroll_periods (period_code, shift_name, status, opened_at, notes)
       VALUES (?, 'Turno noche · 22:00', 'draft', NOW(), 'Jornada España en curso')
       ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
      [todayCode]
    );
    const periodId = periodRes.insertId;
    if (periodId) {
      await recalculatePayrollPeriod(periodId);
    }
  }

  // Seed initial audit log if empty
  const [[auditLogCount]] = await pool.query('SELECT COUNT(*) AS total FROM audit_log').catch(() => [[{ total: 0 }]]);
  if (auditLogCount && auditLogCount.total === 0) {
    const [[keekit]] = await pool.query('SELECT id FROM users WHERE username = "keekit08" LIMIT 1');
    const [[joc]] = await pool.query('SELECT id FROM users WHERE username = "Jo.C" LIMIT 1');
    const [[mitsuno]] = await pool.query('SELECT id FROM users WHERE username = "MitsunoNakae087" LIMIT 1');
    const [[r3belde]] = await pool.query('SELECT id FROM users WHERE username = "R3belde" LIMIT 1');
    const [[ailin]] = await pool.query('SELECT id FROM users WHERE username = "Ailin:0" LIMIT 1');
    const [[gusgus]] = await pool.query('SELECT id FROM users WHERE username = "Gusgus95MX" LIMIT 1');

    const actorKeekit = keekit ? keekit.id : 1;
    const actorJoc = joc ? joc.id : actorKeekit;
    const actorMitsuno = mitsuno ? mitsuno.id : actorKeekit;
    const actorGusgus = gusgus ? gusgus.id : actorKeekit;

    const initialAudit = [
      { actor: actorKeekit, action: 'promotion.earned', type: 'user', id: r3belde ? String(r3belde.id) : '4', meta: { target_username: 'R3belde', from_mission: 'SUP · Ayudante F', to_mission: 'DIR · Iniciado J', detail: 'Supervisor → Director convalidado' }, date: '2026-09-26 21:42:00' },
      { actor: actorMitsuno, action: 'membership.assign', type: 'user', id: '2', meta: { target_username: 'Lunita_Shein', membership: 'Silver', detail: 'Membresía Silver activada' }, date: '2026-09-26 20:18:00' },
      { actor: actorJoc, action: 'payroll.close', type: 'payroll_period', id: '1', meta: { shift: 'Noche · España', members: 176, credits: 1760, detail: '1,760 créditos procesados en nómina' }, date: '2026-09-25 22:03:00' },
      { actor: null, action: 'attendance.confirm', type: 'user', id: ailin ? String(ailin.id) : '6', meta: { target_username: 'Ailin:0', detail: 'Asistencia confirmada en sala' }, date: '2026-09-25 19:54:00' },
      { actor: actorGusgus, action: 'settings.update', type: 'agency', id: null, meta: { keys: ['hours', 'discord'], detail: 'keekit08 actualizó los horarios de la agencia' }, date: '2026-09-25 15:30:00' },
      { actor: actorJoc, action: 'attendance.open', type: 'attendance_session', id: '1', meta: { shift_name: 'Turno noche · 22:00', detail: 'Jo.C registró un pase de lista' }, date: '2026-09-25 21:00:00' }
    ];

    for (const a of initialAudit) {
      await pool.execute(
        `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [a.actor, a.action, a.type, a.id, JSON.stringify(a.meta), a.date]
      );
    }
  }

  // Seed default site content into agency_settings if empty
  const [[contentSetting]] = await pool.query("SELECT setting_key FROM agency_settings WHERE setting_key = 'site_content' LIMIT 1").catch(() => [[]]);
  if (!contentSetting) {
    const defaultContent = {
      banner: {
        title: 'Agencia Shein',
        subtitle: 'Disfruta de sorteos y premios semanales.',
        badge_text: 'BANNER ACTIVO',
        button_text: 'Únete hoy',
        button_url: 'registro.html'
      },
      employees_of_month: [
        { username: 'keekit08', month: 'Septiembre', role: 'Dueño' },
        { username: 'Gusgus95MX', month: 'Septiembre', role: 'Dueño' },
        { username: 'pgg-Pedro', month: 'Septiembre', role: 'Director' }
      ]
    };
    await pool.execute(
      `INSERT INTO agency_settings (setting_key, setting_value) VALUES ('site_content', ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
      [JSON.stringify(defaultContent)]
    );
  }
}

export async function recalculatePayrollPeriod(periodId) {
  const [members] = await pool.query(`
    SELECT u.id AS user_id, u.username, u.rank_id, u.membership_id,
           u.accumulated_attendances, u.accumulated_time_seconds, u.accumulated_promotions,
           r.name AS rank_name, r.pay_salary, r.pay_bonus,
           r.req_salary_attendance, r.req_salary_promotions, r.req_salary_time_hours,
           r.req_bonus_attendance, r.req_bonus_promotions, r.req_bonus_time_hours,
           m.name AS membership_name, m.reduction_percent
    FROM users u
    LEFT JOIN ranks r ON r.id = u.rank_id
    LEFT JOIN memberships_catalog m ON m.id = u.membership_id
    WHERE u.status = 'active'
    ORDER BY COALESCE(r.order_num, 0) DESC, u.username ASC
  `);

  let totalNominal = 0;
  let totalBonus = 0;
  let totalReview = 0;
  let totalCredits = 0;

  for (const member of members) {
    const reduction = (member.reduction_percent > 0) ? (member.reduction_percent / 100) : 0;
    const applyReduction = (val) => Math.ceil(val * (1 - reduction));

    const reqBonusAtt = applyReduction(member.req_bonus_attendance || 0);
    const reqBonusPromo = applyReduction(member.req_bonus_promotions || 0);
    const reqBonusTime = applyReduction(member.req_bonus_time_hours || 0);

    const reqSalaryAtt = applyReduction(member.req_salary_attendance || 0);
    const reqSalaryPromo = applyReduction(member.req_salary_promotions || 0);
    const reqSalaryTime = applyReduction(member.req_salary_time_hours || 0);

    const attCount = member.accumulated_attendances || 0;
    const promoCount = member.accumulated_promotions || 0;
    const timeSec = member.accumulated_time_seconds || 0;
    const timeHours = Math.floor(timeSec / 3600);

    const meetsBonus = (
      attCount >= reqBonusAtt &&
      promoCount >= reqBonusPromo &&
      timeHours >= reqBonusTime
    );

    const meetsSalary = (
      attCount >= reqSalaryAtt &&
      promoCount >= reqSalaryPromo &&
      timeHours >= reqSalaryTime
    );

    const mName = member.membership_name ? member.membership_name.toUpperCase() : '';
    const hasGuardaPaga = mName.includes('GUARDA') || mName.includes('GOLD');

    let qualification = 'review';
    let level = 'low';
    let creditsToPay = 0;
    let discountApplied = null;
    let paymentStatus = 'pending';

    if (reduction > 0) {
      discountApplied = `${member.membership_name} (-${member.reduction_percent}% reqs)`;
    }

    if (meetsBonus && (member.pay_bonus > 0 || member.pay_salary > 0)) {
      qualification = 'bonus';
      level = 'high';
      creditsToPay = member.pay_bonus || member.pay_salary;
      totalBonus++;
    } else if (meetsSalary && member.pay_salary > 0) {
      qualification = 'nominal';
      level = 'low';
      creditsToPay = member.pay_salary;
      totalNominal++;
    } else if (hasGuardaPaga && member.pay_salary > 0) {
      qualification = 'nominal';
      level = 'low';
      creditsToPay = member.pay_salary;
      discountApplied = discountApplied ? `${discountApplied} + Guarda Paga` : 'Guarda Paga garantizada';
      paymentStatus = 'saved';
      totalNominal++;
    } else if (!member.rank_id || (member.pay_salary === 0 && member.pay_bonus === 0)) {
      qualification = 'nominal';
      level = 'low';
      creditsToPay = 0;
      totalNominal++;
    } else {
      qualification = 'review';
      level = 'low';
      creditsToPay = 0;
      totalReview++;
    }

    totalCredits += creditsToPay;

    await pool.execute(
      `INSERT INTO payroll_items (
        period_id, user_id, rank_id, qualification, level,
        attendance_count, time_seconds, promotions_count, signings_count,
        membership_id, discount_applied, credits_to_pay, payment_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        rank_id = VALUES(rank_id),
        qualification = IF(override_by IS NULL, VALUES(qualification), qualification),
        level = VALUES(level),
        attendance_count = VALUES(attendance_count),
        time_seconds = VALUES(time_seconds),
        promotions_count = VALUES(promotions_count),
        membership_id = VALUES(membership_id),
        discount_applied = VALUES(discount_applied),
        credits_to_pay = IF(override_by IS NULL, VALUES(credits_to_pay), credits_to_pay),
        payment_status = VALUES(payment_status)`,
      [
        periodId, member.user_id, member.rank_id, qualification, level,
        attCount, timeSec, promoCount, 0,
        member.membership_id, discountApplied, creditsToPay, paymentStatus
      ]
    );
  }

  // Update totals in period
  await pool.execute(
    `UPDATE payroll_periods
     SET total_evaluated = ?, total_nominal = ?, total_bonus = ?, total_review = ?, total_credits = ?
     WHERE id = ?`,
    [members.length, totalNominal, totalBonus, totalReview, totalCredits, periodId]
  );
}

export async function seedOwner() {
  const defaultHash = hashPassword(process.env.DEFAULT_OWNER_PASSWORD || 'admin123');
  const defaultOwners = 'Gusgus95MX,keekit08';
  const usernames = (process.env.BOOTSTRAP_OWNER || defaultOwners).split(',').map((u) => u.trim()).filter(Boolean);
  for (const username of usernames) {
    await pool.execute(
      `INSERT INTO users (username, role, status, password_hash, last_activity_at)
       VALUES (?, 'owner', 'active', ?, NOW())
       ON DUPLICATE KEY UPDATE role = IF(role = 'pending', 'owner', role),
         password_hash = COALESCE(password_hash, VALUES(password_hash))`,
      [username, defaultHash]
    );
  }
  await seedRanksAndCatalogs();
  await seedInitialAgencyActivity();
}

export async function audit(actorId, action, entityType, entityId = null, metadata = null) {
  await pool.execute(
    'INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata) VALUES (?, ?, ?, ?, ?)',
    [actorId || null, action, entityType, entityId, metadata ? JSON.stringify(metadata) : null]
  );
}



