// ============================================================
// CACAOS SYSTEM — Operators Routes
// ============================================================

const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../db/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/operators
 * List all operators
 */
router.get('/', requireAuth, requireAdmin, (req, res) => {
    try {
        const db = getDb();
        const operators = db.prepare(`
            SELECT id, username, role, full_name, status, created_at
            FROM operators ORDER BY id
        `).all();

        res.json({ operators });
    } catch (err) {
        console.error('[OPERATORS] List error:', err);
        res.status(500).json({ error: 'Error al listar operadores' });
    }
});

/**
 * POST /api/operators
 * Create a new operator
 */
router.post('/', requireAuth, requireAdmin, (req, res) => {
    try {
        const db = getDb();
        const { username, password, role, full_name } = req.body;

        if (!username || !password || !full_name) {
            return res.status(400).json({ error: 'Usuario, contraseña y nombre son requeridos' });
        }

        if (!['admin', 'vendor'].includes(role)) {
            return res.status(400).json({ error: 'Rol debe ser admin o vendor' });
        }

        // Check username uniqueness
        const existing = db.prepare('SELECT id FROM operators WHERE username = ?').get(username);
        if (existing) {
            return res.status(400).json({ error: 'El nombre de usuario ya existe' });
        }

        const password_hash = bcrypt.hashSync(password, 10);
        const result = db.prepare(`
            INSERT INTO operators (username, password_hash, role, full_name)
            VALUES (?, ?, ?, ?)
        `).run(username, password_hash, role, full_name);

        const operator = db.prepare('SELECT id, username, role, full_name, status, created_at FROM operators WHERE id = ?')
            .get(result.lastInsertRowid);

        res.status(201).json({ operator });
    } catch (err) {
        console.error('[OPERATORS] Create error:', err);
        res.status(500).json({ error: 'Error al crear operador' });
    }
});

/**
 * PUT /api/operators/:id
 * Update operator
 */
router.put('/:id', requireAuth, requireAdmin, (req, res) => {
    try {
        const db = getDb();
        const { full_name, password, status, role } = req.body;

        const operator = db.prepare('SELECT * FROM operators WHERE id = ?').get(req.params.id);
        if (!operator) {
            return res.status(404).json({ error: 'Operador no encontrado' });
        }

        let password_hash = operator.password_hash;
        if (password) {
            password_hash = bcrypt.hashSync(password, 10);
        }

        db.prepare(`
            UPDATE operators SET full_name = ?, password_hash = ?, status = ?, role = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(
            full_name || operator.full_name,
            password_hash,
            status || operator.status,
            role || operator.role,
            req.params.id
        );

        const updated = db.prepare('SELECT id, username, role, full_name, status FROM operators WHERE id = ?')
            .get(req.params.id);
        res.json({ operator: updated });
    } catch (err) {
        console.error('[OPERATORS] Update error:', err);
        res.status(500).json({ error: 'Error al actualizar operador' });
    }
});

module.exports = router;
