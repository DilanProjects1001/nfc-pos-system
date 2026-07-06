// ============================================================
// CACAOS SYSTEM — Database Schema
// Club Demo
// ============================================================

const SCHEMA = `
-- ============================================================
-- CONFIGURACIÓN GLOBAL
-- ============================================================
CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- OPERADORES (Admin, Vendedores)
-- ============================================================
CREATE TABLE IF NOT EXISTS operators (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'vendor')),
    full_name TEXT NOT NULL,
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- MIEMBROS DEL CLUB
-- ============================================================
CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_code TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    pin_hash TEXT,
    balance INTEGER DEFAULT 0 CHECK(balance >= 0),
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'suspended')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- TARJETAS NFC
-- ============================================================
CREATE TABLE IF NOT EXISTS cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL REFERENCES members(id),
    card_uid TEXT UNIQUE NOT NULL,
    account_token TEXT UNIQUE NOT NULL,
    counter INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'blocked')),
    assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE RESTRICT
);

-- ============================================================
-- TERMINALES POS
-- ============================================================
CREATE TABLE IF NOT EXISTS terminals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL,
    location TEXT,
    last_heartbeat DATETIME,
    current_shift_id INTEGER,
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- TURNOS EN TERMINALES
-- ============================================================
CREATE TABLE IF NOT EXISTS shifts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    terminal_id INTEGER NOT NULL REFERENCES terminals(id),
    operator_id INTEGER NOT NULL REFERENCES operators(id),
    start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    end_time DATETIME,
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'closed')),
    notes TEXT
);

-- ============================================================
-- AUDITORÍA DE RED DE TERMINALES
-- ============================================================
CREATE TABLE IF NOT EXISTS terminal_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    terminal_id INTEGER NOT NULL REFERENCES terminals(id),
    operator_id INTEGER REFERENCES operators(id),
    event_type TEXT NOT NULL CHECK(event_type IN ('online', 'offline', 'shift_started', 'shift_ended')),
    message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- PRODUCTOS / SERVICIOS
-- ============================================================
CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    terminal_id INTEGER REFERENCES terminals(id),
    name TEXT NOT NULL,
    price INTEGER NOT NULL CHECK(price > 0),
    category TEXT DEFAULT 'general',
    image_url TEXT,
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- TRANSACCIONES (LOG INMUTABLE)
-- ============================================================
CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL REFERENCES members(id),
    card_id INTEGER REFERENCES cards(id),
    terminal_id INTEGER REFERENCES terminals(id),
    operator_id INTEGER NOT NULL REFERENCES operators(id),
    type TEXT NOT NULL CHECK(type IN ('recharge', 'purchase', 'refund', 'cashout')),
    amount INTEGER NOT NULL CHECK(amount > 0),
    balance_before INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    description TEXT,
    refund_of INTEGER REFERENCES transactions(id),
    items_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- BLOQUEO DE TRANSACCIONES (anti-doble-cobro)
-- ============================================================
CREATE TABLE IF NOT EXISTS transaction_locks (
    card_uid TEXT PRIMARY KEY,
    locked_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- ÍNDICES PARA RENDIMIENTO
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_members_code ON members(member_code);
CREATE INDEX IF NOT EXISTS idx_members_name ON members(full_name);
CREATE INDEX IF NOT EXISTS idx_members_phone ON members(phone);
CREATE INDEX IF NOT EXISTS idx_cards_uid ON cards(card_uid);
CREATE INDEX IF NOT EXISTS idx_cards_member ON cards(member_id);
CREATE INDEX IF NOT EXISTS idx_transactions_member ON transactions(member_id);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_transactions_terminal ON transactions(terminal_id);
CREATE INDEX IF NOT EXISTS idx_products_terminal ON products(terminal_id);
`;

module.exports = SCHEMA;
