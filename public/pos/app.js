// ============================================================
// CACAOS POS — Terminal App Logic
// Club Demo
// ============================================================

const API = window.location.origin + '/api';
let TOKEN = localStorage.getItem('cacaos_pos_token');
let OPERATOR = JSON.parse(localStorage.getItem('cacaos_pos_operator') || 'null');
let TERMINAL = JSON.parse(localStorage.getItem('cacaos_pos_terminal') || 'null');
let products = [];
let cart = [];
let checkoutMember = null;
let heartbeatInterval = null;

// ============================================================
// WEBSOCKET (NFC DAEMON)
// ============================================================
let nfcWs = null;
function initNfcWebSocket() {
    try {
        nfcWs = new WebSocket('ws://localhost:3001');
        nfcWs.onopen = () => console.log('✅ NFC WebSocket conectado (POS)');
        nfcWs.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'NFC_SCAN') {
                console.log('NFC Scaneado:', data.uid);
                // Auto-fill and lookup if checkout is open at step 1
                const overlay = document.getElementById('checkoutOverlay');
                const step1 = document.getElementById('checkoutStep1');
                if (overlay && step1 && overlay.style.display === 'flex' && step1.style.display !== 'none') {
                    document.getElementById('checkoutCardId').value = data.uid;
                    lookupCard();
                }
            }
        };
        nfcWs.onclose = () => setTimeout(initNfcWebSocket, 5000); // Reconnect
    } catch(err) { console.warn('NFC WebSocket init fail', err); }
}
initNfcWebSocket();

// ============================================================
// API
// ============================================================
async function api(path, method = 'GET', body = null) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (TOKEN) opts.headers['Authorization'] = `Bearer ${TOKEN}`;
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(API + path, opts);
    const data = await res.json();
    if (!res.ok) {
        if (res.status === 401) { posLogout(); return; }
        throw new Error(data.error || 'Error');
    }
    return data;
}

// ============================================================
// LOGIN — Unified (Auth + Terminal Selection)
// ============================================================
// Load terminals into the dropdown immediately
async function loadPublicTerminals() {
    try {
        const res = await fetch(API + '/terminals/public');
        const termData = await res.json();
        const select = document.getElementById('posTerminalSelect');
        select.innerHTML = '<option value="">-- Seleccionar Terminal --</option>';
        if(termData.terminals) {
            termData.terminals.forEach(t => {
                let text = t.name;
                const opt = new Option('', JSON.stringify({ id: t.id, name: t.name }));
                if (t.current_shift_id) {
                    text += ` (Ocupado por ${t.operator_name || 'Alguien'})`;
                }
                opt.text = text;
                select.add(opt);
            });
        }
    } catch(err) {
        console.error('Failed to grab public terminals:', err);
    }
}
loadPublicTerminals();

document.getElementById('posLoginBtn').addEventListener('click', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('posLoginError');
    errorEl.style.display = 'none';

    const usernameVal = document.getElementById('posUsername').value;
    const passwordVal = document.getElementById('posPassword').value;
    const terminalSelectVal = document.getElementById('posTerminalSelect').value;

    if (!usernameVal || !passwordVal) {
        errorEl.textContent = 'Ingrese usuario y contraseña';
        errorEl.style.display = 'block';
        return;
    }
    if (!terminalSelectVal) {
        errorEl.textContent = 'Seleccione una terminal';
        errorEl.style.display = 'block';
        return;
    }

    const selectedTerminal = JSON.parse(terminalSelectVal);
    const btn = document.getElementById('posLoginBtn');
    
    btn.disabled = true;
    btn.textContent = 'Iniciando sesión...';

    let localToken;
    let localOperator;

    try {
        // Step 1: Login
        const authData = await api('/auth/login', 'POST', {
            username: usernameVal,
            password: passwordVal
        });
        localToken = authData.token;
        localOperator = authData.operator;

        // Step 2: Start Shift using the new Token momentarily
        btn.textContent = 'Asignando terminal...';
        const shiftRes = await fetch(`${API}/terminals/${selectedTerminal.id}/start-shift`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${localToken}`,
                'Content-Type': 'application/json'
            }
        });
        const shiftData = await shiftRes.json();
        if (!shiftRes.ok) {
            throw new Error(shiftData.error || 'Error al asignar la terminal');
        }

        // All good, save everything to global state
        TOKEN = localToken;
        OPERATOR = localOperator;
        TERMINAL = selectedTerminal;

        localStorage.setItem('cacaos_pos_token', TOKEN);
        localStorage.setItem('cacaos_pos_operator', JSON.stringify(OPERATOR));
        localStorage.setItem('cacaos_pos_terminal', JSON.stringify(TERMINAL));
        
        startPOS();

    } catch (err) {
        errorEl.textContent = err.message;
        errorEl.style.display = 'block';
        btn.disabled = false;
        btn.innerHTML = '<span class="material-symbols-rounded">login</span> Iniciar Turno';
    }
});

function startPOS() {
    if (!TERMINAL) return;

    document.body.classList.add('pos-active');
    document.getElementById('posLogin').style.display = 'none';
    document.getElementById('posMain').style.display = 'block';
    document.getElementById('posTerminalName').textContent = TERMINAL.name;
    document.getElementById('posVendorName').textContent = OPERATOR.full_name;

    loadProducts();
    startClock();
    startHeartbeat();
}

async function posLogout() {
    if (TERMINAL && TOKEN) {
        try {
            await fetch(`/api/terminals/${TERMINAL.id}/end-shift`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${TOKEN}` }
            });
        } catch(e) { console.error('Error ending shift', e); }
    }
    TOKEN = null; OPERATOR = null; TERMINAL = null;
    localStorage.removeItem('cacaos_pos_token');
    localStorage.removeItem('cacaos_pos_operator');
    localStorage.removeItem('cacaos_pos_terminal');
    clearInterval(heartbeatInterval);
    document.getElementById('posMain').style.display = 'none';
    document.getElementById('posLogin').style.display = 'flex';
    location.reload();
}

// Ensure shift closes when tab is closed
window.addEventListener('beforeunload', () => {
    if (TERMINAL && TOKEN) {
        fetch(`/api/terminals/${TERMINAL.id}/end-shift`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${TOKEN}` },
            keepalive: true
        }).catch(() => {});
    }
});


// ============================================================
// PRODUCTS
// ============================================================
async function loadProducts() {
    try {
        const data = await api(`/products?terminal_id=${TERMINAL.id}`);
        products = data.products;

        // Category tabs
        const cats = ['all', ...new Set(products.map(p => p.category))];
        document.getElementById('categoryTabs').innerHTML = cats.map(c => {
            const icon = c === 'all' ? '📋' :
                         c === 'Bebidas' ? '🍹' : 
                         c === 'Cervezas' ? '🍺' : 
                         c === 'Botellas VIP' ? '🍾' : 
                         c === 'Comida' ? '🌮' : '🛎️';
            const label = c === 'all' ? 'Todos' : c;
            return `<button class="cat-tab ${c === 'all' ? 'active' : ''}" data-cat="${c}" onclick="filterCategory('${c}', this)">
                        <span class="cat-icon">${icon}</span> ${label}
                    </button>`;
        }).join('');

        renderProducts(products);
    } catch (err) { posToast(err.message, 'error'); }
}

function renderProducts(list) {
    document.getElementById('productGrid').innerHTML = list.map(p => `
        <div class="product-card" onclick="addToCart(${p.id})" id="pcard-${p.id}">
            <div class="p-icon">${p.image_url || '📦'}</div>
            <div class="p-name">${p.name}</div>
            <div class="p-price">${p.price} 🪙</div>
        </div>
    `).join('');
}

function filterCategory(cat, el) {
    document.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
    renderProducts(cat === 'all' ? products : products.filter(p => p.category === cat));
}

document.getElementById('productSearch').addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    const filtered = products.filter(p => p.name.toLowerCase().includes(term));
    renderProducts(filtered);
});

// ============================================================
// CART
// ============================================================
function addToCart(productId) {
    const product = products.find(p => p.id === productId);
    if (!product) return;

    const existing = cart.find(c => c.id === productId);
    if (existing) {
        existing.qty++;
    } else {
        cart.push({ ...product, qty: 1 });
    }

    // Pulse animation
    const card = document.getElementById(`pcard-${productId}`);
    if (card) {
        card.classList.remove('added');
        void card.offsetWidth;
        card.classList.add('added');
    }

    renderCart();
}

function changeQty(productId, delta) {
    const item = cart.find(c => c.id === productId);
    if (!item) return;
    item.qty += delta;
    if (item.qty <= 0) cart = cart.filter(c => c.id !== productId);
    renderCart();
}

function removeFromCart(productId) {
    cart = cart.filter(c => c.id !== productId);
    renderCart();
}

function clearCart() {
    cart = [];
    renderCart();
}

function renderCart() {
    const container = document.getElementById('cartItems');
    const total = cart.reduce((sum, c) => sum + c.price * c.qty, 0);

    if (cart.length === 0) {
        container.innerHTML = `
            <div class="cart-empty">
                <span class="material-symbols-rounded" style="font-size:3rem;color:var(--outline)">shopping_cart</span>
                <p>Agregue productos</p>
            </div>`;
        document.getElementById('cartTotal').textContent = '0 🪙';
        document.getElementById('checkoutBtn').disabled = true;
        return;
    }

    container.innerHTML = cart.map(c => `
        <div class="cart-item">
            <span class="ci-icon">${c.image_url || '📦'}</span>
            <div class="ci-info">
                <div class="ci-name">${c.name}</div>
                <div class="ci-price">${c.price} 🪙 c/u</div>
            </div>
            <div class="ci-qty">
                <button class="qty-btn" onclick="changeQty(${c.id}, -1)">−</button>
                <span class="qty-value">${c.qty}</span>
                <button class="qty-btn" onclick="changeQty(${c.id}, 1)">+</button>
            </div>
            <span class="ci-subtotal">${c.price * c.qty} 🪙</span>
            <button class="ci-remove" onclick="removeFromCart(${c.id})" title="Quitar">×</button>
        </div>
    `).join('');

    document.getElementById('cartTotal').textContent = `${total} 🪙`;
    document.getElementById('checkoutBtn').disabled = false;
    
    // Manage visually selected state in the grid
    document.querySelectorAll('.product-card').forEach(card => card.classList.remove('in-cart'));
    cart.forEach(c => {
        const card = document.getElementById(`pcard-${c.id}`);
        if (card) card.classList.add('in-cart');
    });
}

// ============================================================
// CHECKOUT
// ============================================================
function startCheckout() {
    if (cart.length === 0) return;
    const total = cart.reduce((sum, c) => sum + c.price * c.qty, 0);
    document.getElementById('checkoutAmount').textContent = `${total} 🪙`;
    document.getElementById('checkoutOverlay').style.display = 'flex';
    document.getElementById('checkoutStep1').style.display = 'block';
    document.getElementById('checkoutStep2').style.display = 'none';
    document.getElementById('checkoutStep3').style.display = 'none';
    document.getElementById('checkoutCardId').value = '';
    document.getElementById('checkoutCardId').focus();
}

async function lookupCard() {
    const cardUid = document.getElementById('checkoutCardId').value.trim();
    if (!cardUid) return;

    try {
        const data = await api(`/members/by-card/${encodeURIComponent(cardUid)}`);
        checkoutMember = data.member;
        checkoutMember.card_uid = cardUid;

        const total = cart.reduce((sum, c) => sum + c.price * c.qty, 0);
        const remaining = checkoutMember.balance - total;

        if (remaining < 0) {
            posToast(`Saldo insuficiente: ${checkoutMember.balance} 🪙 (necesita ${total} 🪙)`, 'error');
            return;
        }

        // Show step 2
        document.getElementById('checkoutMemberInfo').innerHTML = `
            <div class="cm-name">${checkoutMember.full_name}</div>
            <div class="cm-code">${checkoutMember.member_code}</div>
        `;
        document.getElementById('checkoutBalance').textContent = `${checkoutMember.balance} 🪙`;
        document.getElementById('checkoutPurchase').textContent = `-${total} 🪙`;
        document.getElementById('checkoutRemaining').textContent = `${remaining} 🪙`;

        document.getElementById('checkoutStep1').style.display = 'none';
        document.getElementById('checkoutStep2').style.display = 'block';
    } catch (err) {
        posToast(err.message, 'error');
    }
}

function backToStep1() {
    document.getElementById('checkoutStep1').style.display = 'block';
    document.getElementById('checkoutStep2').style.display = 'none';
    checkoutMember = null;
}

async function confirmPurchase() {
    if (!checkoutMember) return;
    const total = cart.reduce((sum, c) => sum + c.price * c.qty, 0);

    try {
        const items = cart.map(c => ({ name: c.name, qty: c.qty, price: c.price, subtotal: c.price * c.qty }));
        const description = cart.map(c => `${c.name} x${c.qty}`).join(', ');

        const data = await api('/transactions/purchase', 'POST', {
            member_id: checkoutMember.id,
            card_uid: checkoutMember.card_uid,
            terminal_id: TERMINAL.id,
            amount: total,
            items,
            description
        });

        // Show success
        document.getElementById('checkoutStep2').style.display = 'none';
        document.getElementById('checkoutStep3').style.display = 'block';
        document.getElementById('successDetail').textContent = `Compra: ${total} 🪙 — ${checkoutMember.full_name}`;
        document.getElementById('successBalance').textContent = `Saldo restante: ${data.transaction.balance_after} 🪙`;

        // Auto-close success screen after 3.5 seconds
        setTimeout(() => {
            if (document.getElementById('checkoutStep3').style.display === 'block') {
                finishCheckout();
            }
        }, 3500);

    } catch (err) {
        posToast(err.message, 'error');
    }
}

let checkoutTimeout;

function finishCheckout() {
    document.getElementById('checkoutOverlay').style.display = 'none';
    cart = [];
    checkoutMember = null;
    renderCart();
}

function cancelCheckout() {
    document.getElementById('checkoutOverlay').style.display = 'none';
    checkoutMember = null;
}

// ============================================================
// HEARTBEAT
// ============================================================
function startHeartbeat() {
    heartbeatInterval = setInterval(async () => {
        try {
            const data = await api(`/terminals/${TERMINAL.id}/heartbeat`, 'POST');
            document.getElementById('posConnectionStatus').innerHTML = '<span class="status-dot-sm online"></span> Conectado';
        } catch (err) {
            document.getElementById('posConnectionStatus').innerHTML = '<span class="status-dot-sm offline"></span> Sin conexión';
        }
    }, 30000);

    // Initial heartbeat
    api(`/terminals/${TERMINAL.id}/heartbeat`, 'POST').catch(() => {});
}

// ============================================================
// CLOCK
// ============================================================
function startClock() {
    const update = () => {
        document.getElementById('posClock').textContent = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    };
    update();
    setInterval(update, 1000);
}

// ============================================================
// HISTORY
// ============================================================
let historyVisible = false;

async function toggleHistory() {
    historyVisible = !historyVisible;
    document.getElementById('historyDrawer').style.display = historyVisible ? 'flex' : 'none';

    if (historyVisible) {
        try {
            const today = new Date().toISOString().split('T')[0];
            const data = await api(`/transactions?terminal_id=${TERMINAL.id}&date_from=${today}&limit=50`);
            document.getElementById('vendorHistoryBody').innerHTML = data.transactions.map(tx => `
                <div class="history-item">
                    <div class="hi-top">
                        <span class="hi-name">${tx.member_name}</span>
                        <span class="hi-amount">-${tx.amount} 🪙</span>
                    </div>
                    <div class="hi-time">${new Date(tx.created_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })} • ${tx.description || 'Compra'}</div>
                </div>
            `).join('') || '<p style="padding:1rem;color:var(--on-surface-dim)">Sin transacciones hoy</p>';
        } catch (err) { console.error(err); }
    }
}

// ============================================================
// TOAST
// ============================================================
function posToast(msg, type = 'info') {
    const el = document.getElementById('posToast');
    el.textContent = msg;
    el.className = `toast ${type} show`;
    setTimeout(() => el.classList.remove('show'), 3500);
}

// ============================================================
// INIT
// ============================================================
if (TOKEN && OPERATOR) {
    // Show Step 2 always to force shift creation
    document.getElementById('posLogin').style.display = 'flex';
    document.getElementById('credentialsSection').style.display = 'none';
    document.getElementById('terminalSection').style.display = 'block';
    
    document.getElementById('posLoginBtn').textContent = '▶ Iniciar Turno';
    document.getElementById('posLoginSubtitle').textContent = `Bienvenido, ${OPERATOR.full_name}. Seleccione terminal:`;
    loginStep = 2;

    // Load terminals into select
    api('/terminals').then(termData => {
        const select = document.getElementById('posTerminalSelect');
        select.innerHTML = '<option value="">-- Seleccionar Terminal --</option>';
        termData.terminals.forEach(t => {
            let text = t.name;
            const opt = new Option('', JSON.stringify({ id: t.id, name: t.name }));
            if (t.current_shift_id) {
                opt.disabled = true;
                text += ` (Ocupado por ${t.operator_name || 'Alguien'})`;
            }
            opt.text = text;
            select.add(opt);
        });
    });
} else {
    document.getElementById('posLogin').style.display = 'flex';
}

// Keyboard shortcut: Enter on card input = search
document.getElementById('checkoutCardId')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') lookupCard();
});

window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && TERMINAL && TOKEN) {
        fetch(`/api/terminals/${TERMINAL.id}/end-shift`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${TOKEN}` },
            keepalive: true
        }).catch(() => {});
        
        // Also clear local memory to force re-login upon return
        TERMINAL = null;
        localStorage.removeItem('cacaos_pos_terminal');
        document.getElementById('posMain').style.display = 'none';
        document.getElementById('posLogin').style.display = 'flex';
        location.reload(); 
    }
});
