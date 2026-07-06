// ============================================================
// CACAOS SYSTEM — Auth Routes
// ============================================================

const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../db/database');
const { generateToken, requireAuth } = require('../middleware/auth');

const router = express.Router();

/**
 * POST /api/auth/login
 * Login with username and password
 */
router.post('/login', (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
        }

        const db = getDb();
        const operator = db.prepare(
            'SELECT * FROM operators WHERE username = ? AND status = ?'
        ).get(username, 'active');

        if (!operator) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        const validPassword = bcrypt.compareSync(password, operator.password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        const token = generateToken(operator);

        res.json({
            token,
            operator: {
                id: operator.id,
                username: operator.username,
                role: operator.role,
                full_name: operator.full_name
            }
        });
    } catch (err) {
        console.error('[AUTH] Login error:', err);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

/**
 * GET /api/auth/me
 * Get current operator info
 */
router.get('/me', requireAuth, (req, res) => {
    res.json({ operator: req.operator });
});

module.exports = router;
