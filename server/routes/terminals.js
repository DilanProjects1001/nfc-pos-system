// ============================================================
// CACAOS SYSTEM — Terminals Routes
// ============================================================

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/database');
const { requireAuth, requireAdmin, requireOperator } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/terminals/public
 * Get all terminals without protected data (for POS unified login)
 */
router.get('/public', (req, res) => {
    try {
        const db = getDb();
        // Solo retornamos ID, nombre y si está ocupado
        const terminals = db.prepare(`
            SELECT t.id, t.name, t.current_shift_id,
                   o.full_name as operator_name 
            FROM terminals t
            LEFT JOIN shifts s ON t.current_shift_id = s.id
            LEFT JOIN operators o ON s.operator_id = o.id
            WHERE t.status = 'active'
        `).all();
        res.json({ terminals });
    } catch (err) {
        console.error('[TERMINALS] List public error:', err);
        res.status(500).json({ error: 'Error al listar terminales' });
    }
});

/**
 * GET /api/terminals
 * List all terminals with connection status
 */
router.get('/', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const terminals = db.prepare(`
            SELECT t.*,
                   CASE 
                       WHEN t.last_heartbeat IS NULL THEN 'never'
                       WHEN t.last_heartbeat >= datetime('now', '-60 seconds') THEN 'online'
                       ELSE 'offline'
                   END as connection_status,
                   (SELECT COUNT(*) FROM products p WHERE p.terminal_id = t.id AND p.status = 'active') as product_count,
                   s.start_time as shift_start,
                   o.full_name as operator_name,
                   o.id as operator_id
            FROM terminals t
            LEFT JOIN shifts s ON t.current_shift_id = s.id
            LEFT JOIN operators o ON s.operator_id = o.id
            WHERE t.status = 'active'
            ORDER BY t.id
        `).all();

        res.json({ terminals });
    } catch (err) {
        console.error('[TERMINALS] List error:', err);
        res.status(500).json({ error: 'Error al listar terminales' });
    }
});

/**
 * POST /api/terminals
 * Register a new terminal
 */
router.post('/', requireAuth, requireAdmin, (req, res) => {
    try {
        const db = getDb();
        const { name, location } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'El nombre es requerido' });
        }

        const token = uuidv4();
        const result = db.prepare(`
            INSERT INTO terminals (name, token, location)
            VALUES (?, ?, ?)
        `).run(name, token, location || null);

        const terminal = db.prepare('SELECT * FROM terminals WHERE id = ?').get(result.lastInsertRowid);

        res.status(201).json({ terminal });
    } catch (err) {
        console.error('[TERMINALS] Create error:', err);
        res.status(500).json({ error: 'Error al crear terminal' });
    }
});

/**
 * PUT /api/terminals/:id
 * Update terminal info
 */
router.put('/:id', requireAuth, requireAdmin, (req, res) => {
    try {
        const db = getDb();
        const { name, location, status } = req.body;

        const terminal = db.prepare('SELECT * FROM terminals WHERE id = ?').get(req.params.id);
        if (!terminal) {
            return res.status(404).json({ error: 'Terminal no encontrada' });
        }

        db.prepare(`
            UPDATE terminals SET name = ?, location = ?, status = ? WHERE id = ?
        `).run(name || terminal.name, location !== undefined ? location : terminal.location, status || terminal.status, req.params.id);

        const updated = db.prepare('SELECT * FROM terminals WHERE id = ?').get(req.params.id);
        res.json({ terminal: updated });
    } catch (err) {
        console.error('[TERMINALS] Update error:', err);
        res.status(500).json({ error: 'Error al actualizar terminal' });
    }
});

/**
 * POST /api/terminals/:id/heartbeat
 * Terminal sends heartbeat to confirm it's alive
 */
router.post('/:id/heartbeat', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const terminal = db.prepare('SELECT current_shift_id FROM terminals WHERE id = ?').get(req.params.id);
        
        if (terminal && terminal.current_shift_id) {
            const shift = db.prepare('SELECT operator_id FROM shifts WHERE id = ?').get(terminal.current_shift_id);
            if (shift && shift.operator_id !== req.operator.id && req.operator.role !== 'admin') {
                return res.status(403).json({ error: 'Terminal ocupada por otro usuario' });
            }
        }

        db.prepare('UPDATE terminals SET last_heartbeat = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.id);
        
        // Check for any offline terminals and return alerts
        const offlineTerminals = db.prepare(`
            SELECT name FROM terminals 
            WHERE status = 'active' 
            AND (last_heartbeat IS NULL OR last_heartbeat < datetime('now', '-60 seconds'))
        `).all();

        res.json({ 
            ok: true, 
            alerts: offlineTerminals.length > 0 
                ? { offline_terminals: offlineTerminals.map(t => t.name) }
                : null
        });
    } catch (err) {
        console.error('[TERMINALS] Heartbeat error:', err);
        res.status(500).json({ error: 'Error en heartbeat' });
    }
});

/**
 * POST /api/terminals/:id/start-shift
 * Operator takes control of a terminal
 */
router.post('/:id/start-shift', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const terminalId = req.params.id;
        const operatorId = req.operator.id;

        const terminal = db.prepare('SELECT * FROM terminals WHERE id = ?').get(terminalId);
        if (!terminal) {
            return res.status(404).json({ error: 'Terminal no encontrada' });
        }

        if (terminal.current_shift_id) {
            // Check if it's the same operator reconnecting
            const currentShift = db.prepare('SELECT operator_id FROM shifts WHERE id = ?').get(terminal.current_shift_id);
            if (currentShift && currentShift.operator_id !== operatorId) {
                return res.status(403).json({ error: 'La terminal ya está en uso por otro vendedor' });
            } else if (currentShift && currentShift.operator_id === operatorId) {
                // Same user reconnecting
                return res.json({ ok: true, shift_id: terminal.current_shift_id, reconnected: true });
            }
        }

        // Start transaction
        db.prepare('BEGIN').run();
        try {
            const shiftResult = db.prepare(`
                INSERT INTO shifts (terminal_id, operator_id) VALUES (?, ?)
            `).run(terminalId, operatorId);

            db.prepare(`
                UPDATE terminals SET current_shift_id = ? WHERE id = ?
            `).run(shiftResult.lastInsertRowid, terminalId);

            db.prepare(`
                INSERT INTO terminal_events (terminal_id, operator_id, event_type, message)
                VALUES (?, ?, 'shift_started', 'Turno iniciado desde POS')
            `).run(terminalId, operatorId);

            db.prepare('COMMIT').run();
            res.json({ ok: true, shift_id: shiftResult.lastInsertRowid });
        } catch (txError) {
            db.prepare('ROLLBACK').run();
            throw txError;
        }
    } catch (err) {
        console.error('[TERMINALS] Start shift error:', err);
        res.status(500).json({ error: 'Error al iniciar turno' });
    }
});

/**
 * POST /api/terminals/:id/end-shift
 * Operator releases control of a terminal
 */
router.post('/:id/end-shift', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const terminalId = req.params.id;

        const terminal = db.prepare('SELECT * FROM terminals WHERE id = ?').get(terminalId);
        if (!terminal || !terminal.current_shift_id) {
            return res.json({ ok: true, message: 'La terminal no tenía turno activo' });
        }

        const currentShift = db.prepare('SELECT operator_id FROM shifts WHERE id = ?').get(terminal.current_shift_id);
        if (currentShift && currentShift.operator_id !== req.operator.id && req.operator.role !== 'admin') {
            return res.status(403).json({ error: 'No tienes permiso para cerrar el turno de otra persona' });
        }

        db.prepare('BEGIN').run();
        try {
            db.prepare(`
                UPDATE shifts SET end_time = CURRENT_TIMESTAMP, status = 'closed' WHERE id = ?
            `).run(terminal.current_shift_id);

            db.prepare(`
                UPDATE terminals SET current_shift_id = NULL WHERE id = ?
            `).run(terminalId);

            db.prepare(`
                INSERT INTO terminal_events (terminal_id, operator_id, event_type, message)
                VALUES (?, ?, 'shift_ended', 'Turno cerrado forzosamente o normalmente')
            `).run(terminalId, req.operator.id);

            db.prepare('COMMIT').run();
            res.json({ ok: true });
        } catch (txError) {
            db.prepare('ROLLBACK').run();
            throw txError;
        }
    } catch (err) {
        console.error('[TERMINALS] End shift error:', err);
        res.status(500).json({ error: 'Error al cerrar turno' });
    }
});

/**
 * GET /api/terminals/events
 * Get auditing history of terminal connections and shifts
 */
router.get('/events', requireAuth, requireAdmin, (req, res) => {
    try {
        const db = getDb();
        const limit = parseInt(req.query.limit) || 100;
        const terminalId = req.query.terminal_id;
        
        let query = `
            SELECT e.*, t.name as terminal_name, o.full_name as operator_name
            FROM terminal_events e
            JOIN terminals t ON e.terminal_id = t.id
            LEFT JOIN operators o ON e.operator_id = o.id
        `;
        const params = [];
        if (terminalId) {
            query += ` WHERE e.terminal_id = ?`;
            params.push(terminalId);
        }
        query += ` ORDER BY e.created_at DESC LIMIT ?`;
        params.push(limit);

        const events = db.prepare(query).all(...params);
        res.json({ events });
    } catch (err) {
        console.error('[TERMINALS] List events error:', err);
        res.status(500).json({ error: 'Error al obtener historial' });
    }
});

module.exports = router;
