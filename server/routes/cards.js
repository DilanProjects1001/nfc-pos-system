// ============================================================
// CACAOS SYSTEM — Cards Routes
// ============================================================

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

/**
 * POST /api/cards/assign
 * Assign an NFC card to a member
 */
router.post('/assign', requireAuth, requireAdmin, (req, res) => {
    try {
        const db = getDb();
        const { member_id, card_uid } = req.body;

        if (!member_id || !card_uid) {
            return res.status(400).json({ error: 'ID de miembro y UID de tarjeta son requeridos' });
        }

        // Check member exists
        const member = db.prepare('SELECT * FROM members WHERE id = ?').get(member_id);
        if (!member) {
            return res.status(404).json({ error: 'Miembro no encontrado' });
        }

        // Check card not already assigned
        const existingCard = db.prepare("SELECT * FROM cards WHERE card_uid = ? AND status = 'active'").get(card_uid);
        if (existingCard) {
            return res.status(400).json({ error: 'Esta tarjeta ya está asignada' });
        }

        // Deactivate any current card for this member
        db.prepare("UPDATE cards SET status = 'blocked' WHERE member_id = ? AND status = 'active'").run(member_id);

        // Assign new card
        const token = uuidv4();
        const result = db.prepare(`
            INSERT INTO cards (member_id, card_uid, account_token, counter)
            VALUES (?, ?, ?, 0)
        `).run(member_id, card_uid, token);

        const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(result.lastInsertRowid);

        res.status(201).json({ card, member_name: member.full_name });
    } catch (err) {
        console.error('[CARDS] Assign error:', err);
        res.status(500).json({ error: 'Error al asignar tarjeta' });
    }
});

/**
 * POST /api/cards/block
 * Block a card (lost/stolen)
 */
router.post('/block', requireAuth, requireAdmin, (req, res) => {
    try {
        const db = getDb();
        const { card_id, card_uid } = req.body;

        let card;
        if (card_id) {
            card = db.prepare('SELECT * FROM cards WHERE id = ?').get(card_id);
        } else if (card_uid) {
            card = db.prepare('SELECT * FROM cards WHERE card_uid = ?').get(card_uid);
        }

        if (!card) {
            return res.status(404).json({ error: 'Tarjeta no encontrada' });
        }

        db.prepare("UPDATE cards SET status = 'blocked' WHERE id = ?").run(card.id);

        res.json({ ok: true, message: `Tarjeta ${card.card_uid} bloqueada` });
    } catch (err) {
        console.error('[CARDS] Block error:', err);
        res.status(500).json({ error: 'Error al bloquear tarjeta' });
    }
});

/**
 * GET /api/cards/member/:memberId
 * Get cards for a member
 */
router.get('/member/:memberId', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const cards = db.prepare('SELECT * FROM cards WHERE member_id = ? ORDER BY assigned_at DESC')
            .all(req.params.memberId);
        res.json({ cards });
    } catch (err) {
        console.error('[CARDS] Get error:', err);
        res.status(500).json({ error: 'Error al obtener tarjetas' });
    }
});

module.exports = router;
