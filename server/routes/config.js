// ============================================================
// CACAOS SYSTEM — Config Routes
// ============================================================

const express = require('express');
const { getDb } = require('../db/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/config
 * Get all config values
 */
router.get('/', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const rows = db.prepare('SELECT * FROM config').all();
        const config = {};
        for (const row of rows) {
            config[row.key] = row.value;
        }
        res.json({ config });
    } catch (err) {
        console.error('[CONFIG] Get error:', err);
        res.status(500).json({ error: 'Error al obtener configuración' });
    }
});

/**
 * PUT /api/config
 * Update config values (admin only)
 */
router.put('/', requireAuth, requireAdmin, (req, res) => {
    try {
        const db = getDb();
        const updates = req.body;

        const upsert = db.prepare(`
            INSERT INTO config (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
        `);

        const updateAll = db.transaction(() => {
            for (const [key, value] of Object.entries(updates)) {
                upsert.run(key, String(value));
            }
        });
        updateAll();

        // Return updated config
        const rows = db.prepare('SELECT * FROM config').all();
        const config = {};
        for (const row of rows) {
            config[row.key] = row.value;
        }

        res.json({ config });
    } catch (err) {
        console.error('[CONFIG] Update error:', err);
        res.status(500).json({ error: 'Error al actualizar configuración' });
    }
});

module.exports = router;
