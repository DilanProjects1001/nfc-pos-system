// ============================================================
// CACAOS SYSTEM — Transaction Engine (Core Business Logic)
// ============================================================

const express = require('express');
const { getDb } = require('../db/database');
const { requireAuth, requireAdmin, requireOperator } = require('../middleware/auth');

const router = express.Router();

// ============================================================
// ANTI-DOUBLE-CHARGE LOCK
// ============================================================

function acquireLock(db, cardUid) {
    const lockDuration = db.prepare("SELECT value FROM config WHERE key = 'lock_duration_seconds'").get();
    const seconds = lockDuration ? parseInt(lockDuration.value) : 5;

    // Clean expired locks
    db.prepare(`DELETE FROM transaction_locks WHERE locked_at < datetime('now', '-' || ? || ' seconds')`).run(seconds);

    // Try to acquire lock
    try {
        db.prepare('INSERT INTO transaction_locks (card_uid) VALUES (?)').run(cardUid);
        return true;
    } catch (err) {
        // Lock exists (UNIQUE constraint)
        return false;
    }
}

function releaseLock(db, cardUid) {
    db.prepare('DELETE FROM transaction_locks WHERE card_uid = ?').run(cardUid);
}

// ============================================================
// POST /api/transactions/recharge
// Admin recharges cacaos to a member's account
// ============================================================
router.post('/recharge', requireAuth, requireAdmin, (req, res) => {
    try {
        const db = getDb();
        const { member_id, amount, description } = req.body;

        if (!member_id || !amount || amount <= 0) {
            return res.status(400).json({ error: 'Miembro y monto válido son requeridos' });
        }

        const intAmount = Math.floor(amount);

        const member = db.prepare('SELECT * FROM members WHERE id = ? AND status = ?').get(member_id, 'active');
        if (!member) {
            return res.status(404).json({ error: 'Miembro no encontrado o inactivo' });
        }

        const result = db.transaction(() => {
            const balanceBefore = member.balance;
            const balanceAfter = balanceBefore + intAmount;

            // Update member balance
            db.prepare('UPDATE members SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
                .run(balanceAfter, member_id);

            // Record transaction
            const txResult = db.prepare(`
                INSERT INTO transactions (member_id, operator_id, type, amount, balance_before, balance_after, description)
                VALUES (?, ?, 'recharge', ?, ?, ?, ?)
            `).run(member_id, req.operator.id, intAmount, balanceBefore, balanceAfter, description || 'Recarga de cacaos');

            return {
                transaction_id: txResult.lastInsertRowid,
                member_id,
                member_name: member.full_name,
                member_code: member.member_code,
                type: 'recharge',
                amount: intAmount,
                balance_before: balanceBefore,
                balance_after: balanceAfter,
                equivalent_mxn: intAmount * getExchangeRate(db)
            };
        })();

        console.log(`[TX] Recharge: ${result.member_code} +${result.amount}🪙 (${result.balance_before} → ${result.balance_after})`);
        res.status(201).json({ transaction: result });
    } catch (err) {
        console.error('[TX] Recharge error:', err);
        res.status(500).json({ error: 'Error al realizar recarga' });
    }
});

// ============================================================
// POST /api/transactions/purchase
// Vendor charges cacaos from a member's account
// ============================================================
router.post('/purchase', requireAuth, requireOperator, (req, res) => {
    try {
        const db = getDb();
        const { member_id, card_uid, terminal_id, amount, items, description } = req.body;

        if (!member_id || !amount || amount <= 0) {
            return res.status(400).json({ error: 'Miembro y monto válido son requeridos' });
        }

        const intAmount = Math.floor(amount);

        // Anti-double-charge lock
        if (card_uid && !acquireLock(db, card_uid)) {
            return res.status(429).json({ error: 'Transacción en proceso, espere unos segundos' });
        }

        try {
            const member = db.prepare('SELECT * FROM members WHERE id = ? AND status = ?').get(member_id, 'active');
            if (!member) {
                return res.status(404).json({ error: 'Miembro no encontrado o inactivo' });
            }

            if (member.balance < intAmount) {
                return res.status(400).json({
                    error: 'Saldo insuficiente',
                    balance: member.balance,
                    required: intAmount
                });
            }

            const result = db.transaction(() => {
                const balanceBefore = member.balance;
                const balanceAfter = balanceBefore - intAmount;

                // Update balance
                db.prepare('UPDATE members SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
                    .run(balanceAfter, member_id);

                // Update card counter if card was used
                if (card_uid) {
                    db.prepare('UPDATE cards SET counter = counter + 1 WHERE card_uid = ?').run(card_uid);
                }

                // Find card ID
                let card_id = null;
                if (card_uid) {
                    const card = db.prepare('SELECT id FROM cards WHERE card_uid = ?').get(card_uid);
                    if (card) card_id = card.id;
                }

                // Record transaction
                const itemsJson = items ? JSON.stringify(items) : null;
                const txResult = db.prepare(`
                    INSERT INTO transactions (member_id, card_id, terminal_id, operator_id, type, amount, balance_before, balance_after, description, items_json)
                    VALUES (?, ?, ?, ?, 'purchase', ?, ?, ?, ?, ?)
                `).run(member_id, card_id, terminal_id || null, req.operator.id, intAmount, balanceBefore, balanceAfter, description || 'Compra', itemsJson);

                return {
                    transaction_id: txResult.lastInsertRowid,
                    member_id,
                    member_name: member.full_name,
                    member_code: member.member_code,
                    type: 'purchase',
                    amount: intAmount,
                    balance_before: balanceBefore,
                    balance_after: balanceAfter
                };
            })();

            console.log(`[TX] Purchase: ${result.member_code} -${result.amount}🪙 (${result.balance_before} → ${result.balance_after})`);
            res.status(201).json({ transaction: result });
        } finally {
            if (card_uid) releaseLock(db, card_uid);
        }
    } catch (err) {
        console.error('[TX] Purchase error:', err);
        res.status(500).json({ error: 'Error al procesar compra' });
    }
});

// ============================================================
// POST /api/transactions/refund
// Admin refunds a previous purchase
// ============================================================
router.post('/refund', requireAuth, requireAdmin, (req, res) => {
    try {
        const db = getDb();
        const { transaction_id, reason } = req.body;

        if (!transaction_id) {
            return res.status(400).json({ error: 'ID de transacción requerido' });
        }

        const originalTx = db.prepare('SELECT * FROM transactions WHERE id = ? AND type = ?').get(transaction_id, 'purchase');
        if (!originalTx) {
            return res.status(404).json({ error: 'Transacción de compra no encontrada' });
        }

        // Check if already refunded
        const existingRefund = db.prepare('SELECT * FROM transactions WHERE refund_of = ?').get(transaction_id);
        if (existingRefund) {
            return res.status(400).json({ error: 'Esta transacción ya fue reembolsada' });
        }

        const member = db.prepare('SELECT * FROM members WHERE id = ?').get(originalTx.member_id);
        if (!member) {
            return res.status(404).json({ error: 'Miembro no encontrado' });
        }

        const result = db.transaction(() => {
            const balanceBefore = member.balance;
            const balanceAfter = balanceBefore + originalTx.amount;

            // Return cacaos
            db.prepare('UPDATE members SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
                .run(balanceAfter, member.id);

            // Record refund transaction
            const txResult = db.prepare(`
                INSERT INTO transactions (member_id, terminal_id, operator_id, type, amount, balance_before, balance_after, description, refund_of)
                VALUES (?, ?, ?, 'refund', ?, ?, ?, ?, ?)
            `).run(member.id, originalTx.terminal_id, req.operator.id, originalTx.amount, balanceBefore, balanceAfter,
                reason || `Reembolso de transacción #${transaction_id}`, transaction_id);

            return {
                transaction_id: txResult.lastInsertRowid,
                refund_of: transaction_id,
                member_name: member.full_name,
                amount: originalTx.amount,
                balance_before: balanceBefore,
                balance_after: balanceAfter
            };
        })();

        console.log(`[TX] Refund: TX#${transaction_id} → +${result.amount}🪙 to ${result.member_name}`);
        res.status(201).json({ transaction: result });
    } catch (err) {
        console.error('[TX] Refund error:', err);
        res.status(500).json({ error: 'Error al procesar reembolso' });
    }
});

// ============================================================
// POST /api/transactions/cashout
// Admin withdraws cacaos and returns cash
// ============================================================
router.post('/cashout', requireAuth, requireAdmin, (req, res) => {
    try {
        const db = getDb();
        const { member_id, amount, description } = req.body;

        if (!member_id || !amount || amount <= 0) {
            return res.status(400).json({ error: 'Miembro y monto válido son requeridos' });
        }

        const intAmount = Math.floor(amount);

        const member = db.prepare('SELECT * FROM members WHERE id = ? AND status = ?').get(member_id, 'active');
        if (!member) {
            return res.status(404).json({ error: 'Miembro no encontrado o inactivo' });
        }

        if (member.balance < intAmount) {
            return res.status(400).json({
                error: 'Saldo insuficiente para retiro',
                balance: member.balance,
                requested: intAmount
            });
        }

        const result = db.transaction(() => {
            const balanceBefore = member.balance;
            const balanceAfter = balanceBefore - intAmount;

            db.prepare('UPDATE members SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
                .run(balanceAfter, member_id);

            const txResult = db.prepare(`
                INSERT INTO transactions (member_id, operator_id, type, amount, balance_before, balance_after, description)
                VALUES (?, ?, 'cashout', ?, ?, ?, ?)
            `).run(member_id, req.operator.id, intAmount, balanceBefore, balanceAfter,
                description || `Retiro de cacaos → $${intAmount * getExchangeRate(db)} MXN`);

            return {
                transaction_id: txResult.lastInsertRowid,
                member_id,
                member_name: member.full_name,
                type: 'cashout',
                amount: intAmount,
                balance_before: balanceBefore,
                balance_after: balanceAfter,
                cash_to_return: intAmount * getExchangeRate(db)
            };
        })();

        console.log(`[TX] Cashout: ${result.member_name} -${result.amount}🪙 → $${result.cash_to_return} MXN`);
        res.status(201).json({ transaction: result });
    } catch (err) {
        console.error('[TX] Cashout error:', err);
        res.status(500).json({ error: 'Error al procesar retiro' });
    }
});

// ============================================================
// GET /api/transactions
// List transactions with filters
// ============================================================
router.get('/', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const { member_id, terminal_id, type, date_from, date_to, page = 1, limit = 50 } = req.query;
        const offset = (page - 1) * limit;

        let query = `
            SELECT t.*, m.full_name as member_name, m.member_code,
                   o.full_name as operator_name, term.name as terminal_name
            FROM transactions t
            JOIN members m ON t.member_id = m.id
            JOIN operators o ON t.operator_id = o.id
            LEFT JOIN terminals term ON t.terminal_id = term.id
        `;
        let countQuery = 'SELECT COUNT(*) as total FROM transactions t';

        const conditions = [];
        const params = [];

        if (member_id) { conditions.push('t.member_id = ?'); params.push(member_id); }
        if (terminal_id) { conditions.push('t.terminal_id = ?'); params.push(terminal_id); }
        if (type) { conditions.push('t.type = ?'); params.push(type); }
        if (date_from) { conditions.push('t.created_at >= ?'); params.push(date_from); }
        if (date_to) { conditions.push('t.created_at <= ?'); params.push(date_to + ' 23:59:59'); }

        if (conditions.length > 0) {
            const where = ' WHERE ' + conditions.join(' AND ');
            query += where;
            countQuery += where;
        }

        const total = db.prepare(countQuery).get(...params).total;
        query += ' ORDER BY t.created_at DESC LIMIT ? OFFSET ?';
        const transactions = db.prepare(query).all(...params, parseInt(limit), parseInt(offset));

        res.json({
            transactions,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (err) {
        console.error('[TX] List error:', err);
        res.status(500).json({ error: 'Error al listar transacciones' });
    }
});

// ============================================================
// GET /api/transactions/summary
// Get aggregated transaction stats
// ============================================================
router.get('/summary', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const { date_from, date_to } = req.query;

        let dateFilter = '';
        const params = [];
        if (date_from) {
            dateFilter = ' WHERE created_at >= ?';
            params.push(date_from);
            if (date_to) {
                dateFilter += ' AND created_at <= ?';
                params.push(date_to + ' 23:59:59');
            }
        }

        const summary = db.prepare(`
            SELECT
                type,
                COUNT(*) as count,
                COALESCE(SUM(amount), 0) as total_amount
            FROM transactions
            ${dateFilter}
            GROUP BY type
        `).all(...params);

        const totalCirculation = db.prepare('SELECT COALESCE(SUM(balance), 0) as total FROM members').get().total;
        const activeMembers = db.prepare("SELECT COUNT(*) as count FROM members WHERE status = 'active'").get().count;
        const exchangeRate = getExchangeRate(db);

        const totalSold = db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = 'recharge'").get().total;

        // Today's transactions
        const todayStart = new Date().toISOString().split('T')[0];
        const todayTx = db.prepare(`
            SELECT COUNT(*) as count, COALESCE(SUM(CASE WHEN type = 'recharge' THEN amount ELSE 0 END), 0) as recharges
            FROM transactions WHERE created_at >= ?
        `).get(todayStart);

        // Weekly data for chart
        const weeklyData = db.prepare(`
            SELECT 
                DATE(created_at) as date, 
                COUNT(*) as count, 
                COUNT(CASE WHEN type = 'purchase' THEN 1 END) as tx_count,
                COALESCE(SUM(CASE WHEN type = 'purchase' THEN amount ELSE 0 END), 0) as spent,
                COALESCE(SUM(CASE WHEN type = 'recharge' THEN amount ELSE 0 END), 0) as recharged
            FROM transactions
            WHERE created_at >= date('now', '-7 days')
            GROUP BY DATE(created_at)
            ORDER BY date
        `).all();

        res.json({
            summary: summary.reduce((acc, s) => { acc[s.type] = { count: s.count, total: s.total_amount }; return acc; }, {}),
            total_circulation: totalCirculation,
            total_sold: totalSold,
            active_members: activeMembers,
            exchange_rate: exchangeRate,
            today: {
                transactions: todayTx.count,
                recharges_cacaos: todayTx.recharges,
                recharges_mxn: todayTx.recharges * exchangeRate
            },
            weekly: weeklyData
        });
    } catch (err) {
        console.error('[TX] Summary error:', err);
        res.status(500).json({ error: 'Error al obtener resumen' });
    }
});

// ============================================================
function getExchangeRate(db) {
    const rate = db.prepare("SELECT value FROM config WHERE key = 'exchange_rate'").get();
    return rate ? parseInt(rate.value) : 10;
}

module.exports = router;
