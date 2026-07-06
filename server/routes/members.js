// ============================================================
// CACAOS SYSTEM — Members Routes
// ============================================================

const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/members
 * List all members with optional search/filter
 */
router.get('/', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const { search, status, page = 1, limit = 50 } = req.query;
        const offset = (page - 1) * limit;

        let query = "SELECT m.*, c.card_uid, c.status as card_status FROM members m LEFT JOIN cards c ON m.id = c.member_id AND c.status = 'active'";
        let countQuery = 'SELECT COUNT(*) as total FROM members m';
        const conditions = [];
        const params = [];

        if (search) {
            conditions.push('(m.full_name LIKE ? OR m.member_code LIKE ? OR m.phone LIKE ?)');
            const term = `%${search}%`;
            params.push(term, term, term);
        }

        if (status && status !== 'all') {
            conditions.push('m.status = ?');
            params.push(status);
        }

        if (conditions.length > 0) {
            const where = ' WHERE ' + conditions.join(' AND ');
            query += where;
            countQuery += where;
        }

        const total = db.prepare(countQuery).get(...params).total;

        query += ' ORDER BY m.id DESC LIMIT ? OFFSET ?';
        const members = db.prepare(query).all(...params, parseInt(limit), parseInt(offset));

        res.json({
            members,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (err) {
        console.error('[MEMBERS] List error:', err);
        res.status(500).json({ error: 'Error al listar miembros' });
    }
});

/**
 * GET /api/members/by-card/:cardUid
 * Find member by NFC card UID
 */
router.get('/by-card/:cardUid', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const card = db.prepare(`
            SELECT c.*, m.member_code, m.full_name, m.phone, m.balance, m.status as member_status, m.pin_hash
            FROM cards c
            JOIN members m ON c.member_id = m.id
            WHERE c.card_uid = ? AND c.status = 'active'
        `).get(req.params.cardUid);

        if (!card) {
            return res.status(404).json({ error: 'Tarjeta no encontrada o bloqueada' });
        }

        if (card.member_status !== 'active') {
            return res.status(403).json({ error: 'Miembro suspendido' });
        }

        res.json({
            member: {
                id: card.member_id,
                member_code: card.member_code,
                full_name: card.full_name,
                phone: card.phone,
                balance: card.balance,
                status: card.member_status,
                has_pin: !!card.pin_hash
            },
            card: {
                id: card.id,
                card_uid: card.card_uid,
                counter: card.counter,
                status: card.status
            }
        });
    } catch (err) {
        console.error('[MEMBERS] Card lookup error:', err);
        res.status(500).json({ error: 'Error al buscar tarjeta' });
    }
});

/**
 * GET /api/members/:id
 * Get member detail with card info and recent transactions
 */
router.get('/:id', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const member = db.prepare(`
            SELECT m.*, c.card_uid, c.status as card_status, c.counter as card_counter
            FROM members m
            LEFT JOIN cards c ON m.id = c.member_id AND c.status = 'active'
            WHERE m.id = ?
        `).get(req.params.id);

        if (!member) {
            return res.status(404).json({ error: 'Miembro no encontrado' });
        }

        // Get recent transactions
        const transactions = db.prepare(`
            SELECT t.*, o.full_name as operator_name, term.name as terminal_name
            FROM transactions t
            LEFT JOIN operators o ON t.operator_id = o.id
            LEFT JOIN terminals term ON t.terminal_id = term.id
            WHERE t.member_id = ?
            ORDER BY t.created_at DESC
            LIMIT 10
        `).all(req.params.id);

        res.json({ member, transactions });
    } catch (err) {
        console.error('[MEMBERS] Get error:', err);
        res.status(500).json({ error: 'Error al obtener miembro' });
    }
});

/**
 * POST /api/members
 * Create a new member
 */
router.post('/', requireAuth, requireAdmin, (req, res) => {
    try {
        const db = getDb();
        const { full_name, phone, email, pin, card_uid } = req.body;

        if (!full_name || !card_uid) {
            return res.status(400).json({ error: 'Nombre y UID de Tarjeta son obligatorios' });
        }

        // Check if card exists
        const existingCard = db.prepare('SELECT id FROM cards WHERE card_uid = ?').get(card_uid);
        if (existingCard) {
            return res.status(400).json({ error: 'Esta tarjeta ya está vinculada a un miembro' });
        }

        db.prepare('BEGIN').run();
        try {
            // Generate next member code
            const lastMember = db.prepare(
                "SELECT member_code FROM members ORDER BY id DESC LIMIT 1"
            ).get();

            let nextNum = 1;
            if (lastMember) {
                const match = lastMember.member_code.match(/CAC-(\d+)/);
                if (match) nextNum = parseInt(match[1]) + 1;
            }
            const member_code = `CAC-${String(nextNum).padStart(4, '0')}`;

            let pin_hash = null;
            if (pin) {
                pin_hash = bcrypt.hashSync(String(pin), 10);
            }

            const result = db.prepare(`
                INSERT INTO members (member_code, full_name, phone, email, pin_hash)
                VALUES (?, ?, ?, ?, ?)
            `).run(member_code, full_name, phone || null, email || null, pin_hash);

            const memberId = result.lastInsertRowid;

            // Link Card
            const accountToken = uuidv4();
            db.prepare(`
                INSERT INTO cards (card_uid, member_id, account_token, status) VALUES (?, ?, ?, 'active')
            `).run(card_uid, memberId, accountToken);

            db.prepare('COMMIT').run();

            const newMember = db.prepare('SELECT m.*, c.card_uid FROM members m LEFT JOIN cards c ON m.id = c.member_id WHERE m.id = ?').get(memberId);

            res.status(201).json({ member: newMember });
        } catch (txErr) {
            db.prepare('ROLLBACK').run();
            throw txErr;
        }
    } catch (err) {
        console.error('[MEMBERS] Create error:', err);
        res.status(500).json({ error: 'Error al crear miembro' });
    }
});

/**
 * PUT /api/members/:id
 * Update member info
 */
router.put('/:id', requireAuth, requireAdmin, (req, res) => {
    try {
        const db = getDb();
        const { full_name, phone, email, status, pin } = req.body;

        const member = db.prepare('SELECT * FROM members WHERE id = ?').get(req.params.id);
        if (!member) {
            return res.status(404).json({ error: 'Miembro no encontrado' });
        }

        let pin_hash = member.pin_hash;
        if (pin !== undefined) {
            pin_hash = pin ? bcrypt.hashSync(String(pin), 10) : null;
        }

        db.prepare(`
            UPDATE members 
            SET full_name = ?, phone = ?, email = ?, status = ?, pin_hash = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(
            full_name || member.full_name,
            phone !== undefined ? phone : member.phone,
            email !== undefined ? email : member.email,
            status || member.status,
            pin_hash,
            req.params.id
        );

        const updated = db.prepare('SELECT * FROM members WHERE id = ?').get(req.params.id);
        res.json({ member: updated });
    } catch (err) {
        console.error('[MEMBERS] Update error:', err);
        res.status(500).json({ error: 'Error al actualizar miembro' });
    }
});

module.exports = router;
