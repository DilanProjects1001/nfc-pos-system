const { getDb } = require('./server/db/database');

try {
    const db = getDb();
    db.exec(`
        CREATE TABLE IF NOT EXISTS shifts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            terminal_id INTEGER NOT NULL REFERENCES terminals(id),
            operator_id INTEGER NOT NULL REFERENCES operators(id),
            start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
            end_time DATETIME,
            status TEXT DEFAULT 'active' CHECK(status IN ('active', 'closed')),
            notes TEXT
        );
    `);
    
    try {
        db.exec(`ALTER TABLE terminals ADD COLUMN current_shift_id INTEGER;`);
        console.log("Migration applied: added current_shift_id");
    } catch(e) {
        if(e.message.includes('duplicate column')) {
            console.log("Column already exists");
        } else {
            console.error("Alter table error:", e);
        }
    }
    
    console.log("Migration complete");
} catch(err) {
    console.error("Migration error:", err);
}
