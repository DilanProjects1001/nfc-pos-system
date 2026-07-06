const { getDb } = require('./server/db/database');
try {
    const db = getDb();
    const query = 'SELECT m.*, c.card_uid, c.status as card_status FROM members m LEFT JOIN cards c ON m.id = c.member_id AND c.status = "active" ORDER BY m.id DESC LIMIT 50 OFFSET 0';
    const res = db.prepare(query).all();
    console.log("Success:", res.length);
} catch (e) {
    console.error("DB Error message:", e.message);
}
