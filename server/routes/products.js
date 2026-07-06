// ============================================================
// CACAOS SYSTEM — Products Routes
// ============================================================

const express = require('express');
const { getDb } = require('../db/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/products
 * List products, optionally filtered by terminal
 */
router.get('/', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const { terminal_id, category, status = 'active' } = req.query;

        let query = `
            SELECT p.*, t.name as terminal_name 
            FROM products p 
            LEFT JOIN terminals t ON p.terminal_id = t.id
        `;
        const conditions = ['p.status = ?'];
        const params = [status];

        if (terminal_id) {
            conditions.push('(p.terminal_id = ? OR p.terminal_id IS NULL)');
            params.push(terminal_id);
        }
        if (category) {
            conditions.push('p.category = ?');
            params.push(category);
        }

        query += ' WHERE ' + conditions.join(' AND ');
        query += ' ORDER BY p.category, p.name';

        const products = db.prepare(query).all(...params);

        // Get unique categories
        const categories = db.prepare(
            'SELECT DISTINCT category FROM products WHERE status = ? ORDER BY category'
        ).all('active').map(c => c.category);

        res.json({ products, categories });
    } catch (err) {
        console.error('[PRODUCTS] List error:', err);
        res.status(500).json({ error: 'Error al listar productos' });
    }
});

/**
 * POST /api/products
 * Create a new product
 */
router.post('/', requireAuth, requireAdmin, (req, res) => {
    try {
        const db = getDb();
        const { terminal_id, name, price, category, image_url } = req.body;

        if (!name || !price || price <= 0) {
            return res.status(400).json({ error: 'Nombre y precio válido son requeridos' });
        }

        const result = db.prepare(`
            INSERT INTO products (terminal_id, name, price, category, image_url)
            VALUES (?, ?, ?, ?, ?)
        `).run(terminal_id || null, name, Math.floor(price), category || 'General', image_url || '📦');

        const product = db.prepare('SELECT * FROM products WHERE id = ?').get(result.lastInsertRowid);
        res.status(201).json({ product });
    } catch (err) {
        console.error('[PRODUCTS] Create error:', err);
        res.status(500).json({ error: 'Error al crear producto' });
    }
});

/**
 * PUT /api/products/:id
 * Update a product
 */
router.put('/:id', requireAuth, requireAdmin, (req, res) => {
    try {
        const db = getDb();
        const { name, price, category, terminal_id, status } = req.body;

        const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
        if (!product) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }

        db.prepare(`
            UPDATE products SET name = ?, price = ?, category = ?, terminal_id = ?, status = ? WHERE id = ?
        `).run(
            name || product.name,
            price ? Math.floor(price) : product.price,
            category || product.category,
            terminal_id !== undefined ? terminal_id : product.terminal_id,
            status || product.status,
            req.params.id
        );

        const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
        res.json({ product: updated });
    } catch (err) {
        console.error('[PRODUCTS] Update error:', err);
        res.status(500).json({ error: 'Error al actualizar producto' });
    }
});

/**
 * DELETE /api/products/:id
 * Soft-delete a product
 */
router.delete('/:id', requireAuth, requireAdmin, (req, res) => {
    try {
        const db = getDb();
        db.prepare("UPDATE products SET status = 'inactive' WHERE id = ?").run(req.params.id);
        res.json({ ok: true });
    } catch (err) {
        console.error('[PRODUCTS] Delete error:', err);
        res.status(500).json({ error: 'Error al eliminar producto' });
    }
});

module.exports = router;
