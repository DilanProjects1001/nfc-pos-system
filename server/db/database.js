// ============================================================
// CACAOS SYSTEM — Database Connection & Helpers
// ============================================================

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const SCHEMA = require('./schema');

const DB_DIR = path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DB_DIR, 'cacaos.db');
const BACKUP_DIR = path.join(DB_DIR, 'backups');

// Ensure directories exist
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

let db;

function getDb() {
    if (!db) {
        db = new Database(DB_PATH);
        // Performance optimizations for SQLite
        db.pragma('journal_mode = WAL');       // Write-Ahead Logging for concurrency
        db.pragma('foreign_keys = ON');        // Enforce foreign keys
        db.pragma('busy_timeout = 5000');      // Wait 5s if locked
        db.pragma('synchronous = NORMAL');     // Good balance speed/safety
    }
    return db;
}

function initializeDatabase() {
    const database = getDb();
    database.exec(SCHEMA);
    console.log('[DB] Schema initialized successfully');
    return database;
}

function backupDatabase() {
    const database = getDb();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(BACKUP_DIR, `cacaos_backup_${timestamp}.db`);
    
    database.backup(backupPath)
        .then(() => {
            console.log(`[DB] Backup created: ${backupPath}`);
            // Keep only last 7 backups
            cleanOldBackups();
        })
        .catch(err => {
            console.error('[DB] Backup failed:', err);
        });
}

function cleanOldBackups() {
    const files = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.startsWith('cacaos_backup_') && f.endsWith('.db'))
        .sort()
        .reverse();
    
    // Keep only 7 most recent
    for (let i = 7; i < files.length; i++) {
        fs.unlinkSync(path.join(BACKUP_DIR, files[i]));
        console.log(`[DB] Old backup removed: ${files[i]}`);
    }
}

function closeDatabase() {
    if (db) {
        db.close();
        db = null;
        console.log('[DB] Connection closed');
    }
}

module.exports = {
    getDb,
    initializeDatabase,
    backupDatabase,
    closeDatabase,
    DB_PATH,
    BACKUP_DIR
};
