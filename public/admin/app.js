// ============================================================
// CACAOS SYSTEM — Admin Panel App Logic
// Club Demo
// ============================================================

const API = window.location.origin + '/api';
let TOKEN = localStorage.getItem('cacaos_token');
let OPERATOR = JSON.parse(localStorage.getItem('cacaos_operator') || 'null');
let CONFIG = {};
let currentView = 'dashboard';
let selectedRechargeId = null;
let selectedCashoutId = null;
let memberSearchTimeout = null;

// ============================================================
// WEBSOCKET (NFC DAEMON)
// ============================================================
let nfcWs = null;
function initNfcWebSocket() {
    try {
        nfcWs = new WebSocket('ws://localhost:3001');
        nfcWs.onopen = () => console.log('✅ NFC WebSocket conectado (Admin)');
        nfcWs.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'NFC_SCAN') {
                console.log('NFC Scaneado:', data.uid);
                
                // If New Member modal is open, fill the card uid there
                const newMemberModal = document.getElementById('newMemberModal');
                if (newMemberModal && newMemberModal.style.display !== 'none') {
                    const uidInput = document.getElementById('newMemberCardUid');
                    if (uidInput) uidInput.value = data.uid;
                    return; // Stop here
                }
                
                // Otherwise, default to Dashboard recharge lookup
                if (currentView === 'dashboard') {
                    const rechargeInput = document.getElementById('rechargeCardId');
                    if (rechargeInput) {
                        rechargeInput.value = data.uid;
                        // Trigger blur or enter to execute search function
                        rechargeInput.dispatchEvent(new Event('input'));
                        if (typeof searchMemberNfc === 'function') searchMemberNfc(data.uid);
                    }
                }
            }
        };
        nfcWs.onclose = () => setTimeout(initNfcWebSocket, 5000); // Reconnect
    } catch(err) { console.warn('NFC WebSocket init fail', err); }
}
initNfcWebSocket();

// ============================================================
// API HELPER
// ============================================================
async function api(path, method = 'GET', body = null) {
    const opts = {
        method,
        headers: { 'Content-Type': 'application/json' }
    };
    if (TOKEN) opts.headers['Authorization'] = `Bearer ${TOKEN}`;
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(API + path, opts);
    const data = await res.json();
    
    if (!res.ok) {
        if (res.status === 401) { logout(); return; }
        throw new Error(data.error || 'Error desconocido');
    }
    return data;
}

// ============================================================
// AUTH
// ============================================================
document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('loginError');
    errorEl.style.display = 'none';
    
    try {
        const data = await api('/auth/login', 'POST', {
            username: document.getElementById('loginUser').value,
            password: document.getElementById('loginPass').value
        });
        
        TOKEN = data.token;
        OPERATOR = data.operator;
        localStorage.setItem('cacaos_token', TOKEN);
        localStorage.setItem('cacaos_operator', JSON.stringify(OPERATOR));
        
        showApp();
    } catch (err) {
        errorEl.textContent = err.message;
        errorEl.style.display = 'block';
    }
});

function logout() {
    TOKEN = null;
    OPERATOR = null;
    localStorage.removeItem('cacaos_token');
    localStorage.removeItem('cacaos_operator');
    document.getElementById('mainApp').style.display = 'none';
    document.getElementById('loginScreen').style.display = 'flex';
}

document.getElementById('logoutBtn').addEventListener('click', logout);

// ============================================================
// APP INIT
// ============================================================
function showApp() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('mainApp').style.display = 'flex';
    document.getElementById('userName').textContent = OPERATOR.full_name;
    document.getElementById('userRole').textContent = OPERATOR.role === 'admin' ? 'Administrador' : 'Vendedor';
    document.getElementById('userAvatar').textContent = OPERATOR.full_name.charAt(0).toUpperCase();
    document.getElementById('currentDate').textContent = new Date().toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    
    loadConfig();
    navigate('dashboard');
}

// ============================================================
// NAVIGATION
// ============================================================
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        navigate(item.dataset.view);
    });
});

function navigate(view) {
    currentView = view;
    
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelector(`.nav-item[data-view="${view}"]`)?.classList.add('active');
    
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(`view-${view}`)?.classList.add('active');
    
    // Load data for view
    switch(view) {
        case 'dashboard': loadDashboard(); break;
        case 'members': loadMembers(); break;
        case 'history': loadHistory(); break;
        case 'alerts': loadAlerts(); break;
        case 'recharge': cancelRecharge(); break;
        case 'terminals': loadTerminals(); break;
        case 'products': loadProducts(); break;
        case 'operators': loadOperators(); break;
        case 'config': loadConfigView(); break;
    }
}

// ============================================================
// CONFIG
// ============================================================
async function loadConfig() {
    try {
        const data = await api('/config');
        CONFIG = data.config;
    } catch (err) {
        console.error('Failed to load config:', err);
    }
}

async function loadConfigView() {
    await loadConfig();
    document.getElementById('cfgBusinessName').value = CONFIG.business_name || '';
    document.getElementById('cfgExchangeRate').value = CONFIG.exchange_rate || '10';
    document.getElementById('cfgPinAbove').value = CONFIG.require_pin_above || '0';
}

async function saveConfig() {
    try {
        await api('/config', 'PUT', {
            business_name: document.getElementById('cfgBusinessName').value,
            exchange_rate: document.getElementById('cfgExchangeRate').value,
            require_pin_above: document.getElementById('cfgPinAbove').value
        });
        toast('Configuración guardada', 'success');
        loadConfig();
    } catch (err) { toast(err.message, 'error'); }
}

// ============================================================
// DASHBOARD
// ============================================================
async function loadDashboard() {
    try {
        const data = await api('/transactions/summary');
        const rate = data.exchange_rate || 10;

        document.getElementById('kpiCirculation').textContent = `${data.total_circulation.toLocaleString()} 🪙`;
        document.getElementById('kpiTotalSold').textContent = (data.total_sold || 0).toLocaleString();
        document.getElementById('kpiMembers').textContent = data.active_members;
        document.getElementById('kpiTxToday').textContent = data.today.transactions;
        document.getElementById('kpiRevenue').textContent = `$${data.today.recharges_mxn.toLocaleString()} MXN`;
        document.getElementById('kpiCacaosSoldToday').textContent = (data.today.recharges_cacaos || 0).toLocaleString();

        // Weekly chart
        renderChartSpent(data.weekly);
        renderChartRecharged(data.weekly);

        // Recent transactions
        const txData = await api('/transactions?limit=8');
        const tbody = document.getElementById('recentTxBody');
        tbody.innerHTML = txData.transactions.map(tx => `
            <tr>
                <td>${formatTime(tx.created_at)}</td>
                <td>${tx.member_name}</td>
                <td>${typeBadge(tx.type)}</td>
                <td>${tx.type === 'purchase' || tx.type === 'cashout' ? '-' : '+'}${tx.amount} 🪙</td>
                <td>${tx.terminal_name || 'Servidor'}</td>
            </tr>
        `).join('');

        // Terminal status
        const termData = await api('/terminals');
        const list = document.getElementById('terminalStatusList');
        list.innerHTML = termData.terminals.map(t => `
            <div class="terminal-status-item">
                <span class="ts-name">${t.name}</span>
                <span class="status-dot ${t.connection_status === 'online' ? 'online' : t.connection_status === 'never' ? 'offline' : 'offline'}"></span>
            </div>
        `).join('');

        // Check for offline terminals
        const offline = termData.terminals.filter(t => t.connection_status === 'offline');
        if (offline.length > 0) {
            document.getElementById('alertBanner').style.display = 'flex';
            document.getElementById('alertText').textContent = `⚠️ Terminal(es) desconectada(s): ${offline.map(t => t.name).join(', ')}`;
        } else {
            document.getElementById('alertBanner').style.display = 'none';
        }

    } catch (err) { console.error('Dashboard load failed:', err); }
}

function renderChartSpent(data) {
    const container = document.getElementById('weeklyChartSpent');
    if (!container) return;
    if (!data || data.length === 0) {
        container.innerHTML = '<p style="color:var(--on-surface-dim);text-align:center;width:100%">Sin datos esta semana</p>';
        return;
    }
    const maxCount = Math.max(...data.map(d => d.tx_count), 1);
    container.innerHTML = data.map(d => {
        const height = Math.max((d.tx_count / maxCount) * 160, 8);
        const dayName = new Date(d.date + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'short' });
        return `
            <div class="chart-bar" style="height:${height}px" title="${d.tx_count} compras | ${d.spent} 🪙 gastados">
                <span class="chart-bar-value" style="font-size: 0.8rem; line-height: 1.1; display:flex; flex-direction:column; align-items:center;">
                    <strong>${d.tx_count}</strong>
                    <span style="color:var(--warning); font-size: 0.75rem;">${d.spent} 🪙</span>
                </span>
                <span class="chart-bar-label">${dayName}</span>
            </div>`;
    }).join('');
}

function renderChartRecharged(data) {
    const container = document.getElementById('weeklyChartRecharged');
    if (!container) return;
    if (!data || data.length === 0) {
        container.innerHTML = '<p style="color:var(--on-surface-dim);text-align:center;width:100%">Sin datos esta semana</p>';
        return;
    }
    const maxVol = Math.max(...data.map(d => d.recharged), 1);
    container.innerHTML = data.map(d => {
        const height = Math.max((d.recharged / maxVol) * 160, 8);
        const dayName = new Date(d.date + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'short' });
        return `
            <div class="chart-bar" style="height:${height}px; background: rgba(34, 197, 94, 0.15); border-top: 2px solid rgba(34, 197, 94, 0.5);" title="${d.recharged} 🪙 recargados">
                <span class="chart-bar-value" style="font-size:0.85rem; color:var(--success); font-weight: 600;">${d.recharged} 🪙</span>
                <span class="chart-bar-label">${dayName}</span>
            </div>`;
    }).join('');
}

// ============================================================
// MEMBERS
// ============================================================
let membersPage = 1;
let membersFilter = 'all';

document.getElementById('memberSearch').addEventListener('input', debounce(() => loadMembers(), 300));

function filterMembers(status, el) {
    document.querySelectorAll('.filter-chips .chip').forEach(c => c.classList.remove('active'));
    el.classList.add('active');
    membersFilter = status;
    membersPage = 1;
    loadMembers();
}

async function loadMembers() {
    try {
        const search = document.getElementById('memberSearch').value;
        let url = `/members?page=${membersPage}&limit=15`;
        if (search) url += `&search=${encodeURIComponent(search)}`;
        if (membersFilter !== 'all') url += `&status=${membersFilter}`;

        const data = await api(url);
        const tbody = document.getElementById('membersBody');
        
        tbody.innerHTML = data.members.map(m => `
            <tr>
                <td><strong>${m.member_code}</strong></td>
                <td>${m.full_name}</td>
                <td>${m.phone || '—'}</td>
                <td><strong>${m.balance.toLocaleString()} 🪙</strong></td>
                <td>${m.card_uid ? `<span class="badge badge-${m.card_status === 'active' ? 'active' : 'blocked'}">${m.card_status === 'active' ? '●Activa' : '●Bloqueada'}</span>` : '<span style="color:var(--on-surface-dim)">Sin tarjeta</span>'}</td>
                <td><span class="badge badge-${m.status}">${m.status === 'active' ? '🟢 Activo' : '🟡 Suspendido'}</span></td>
                <td>
                    <button class="btn-small" onclick="viewMember(${m.id})">Ver</button>
                    <button class="btn-small" onclick="goRecharge(${m.id}, '${m.full_name}', ${m.balance}, '${m.member_code}')">Recargar</button>
                </td>
            </tr>
        `).join('');

        renderPagination('membersPagination', data.pagination, (p) => { membersPage = p; loadMembers(); });
    } catch (err) { toast(err.message, 'error'); }
}

async function createMember() {
    try {
        const data = await api('/members', 'POST', {
            full_name: document.getElementById('newMemberName').value,
            phone: document.getElementById('newMemberPhone').value,
            email: document.getElementById('newMemberEmail').value,
            pin: document.getElementById('newMemberPin').value || null,
            card_uid: document.getElementById('newMemberCardUid').value // Add card
        });
        hideModals();
        toast(`Miembro ${data.member.member_code} creado`, 'success');
        loadMembers();
    } catch (err) { toast(err.message, 'error'); }
}

async function viewMember(id) {
    try {
        const data = await api(`/members/${id}`);
        const m = data.member;
        alert(`${m.member_code} — ${m.full_name}\nSaldo: ${m.balance} 🪙\nTeléfono: ${m.phone || 'N/A'}\nTarjeta: ${m.card_uid || 'Sin asignar'}\n\nÚltimas transacciones:\n${data.transactions.map(t => `  ${t.type}: ${t.amount}🪙 (${formatTime(t.created_at)})`).join('\n')}`);
    } catch (err) { toast(err.message, 'error'); }
}

function goRecharge(id, name, balance, code) {
    selectedRechargeId = { id, name, balance, code };
    navigate('recharge');
    showRechargeMember({ id, full_name: name, balance, member_code: code });
}

// ============================================================
// RECHARGE
// ============================================================
// BÚSQUEDA MANUAL DESHABILITADA POR SEGURIDAD
// Obliga a usar la tarjeta física
// document.getElementById('rechargeSearch').addEventListener('input', debounce(async () => { ... }));

async function lookupCardForRecharge() {
    const cardUid = document.getElementById('rechargeCardId').value.trim();
    if (!cardUid) return;
    try {
        const data = await api(`/members/by-card/${encodeURIComponent(cardUid)}`);
        showRechargeMember({ id: data.member.id, full_name: data.member.full_name, balance: data.member.balance, member_code: data.member.member_code });
    } catch (err) { toast(err.message, 'error'); }
}

function showRechargeMember(member) {
    selectedRechargeId = member;
    document.getElementById('rechargeForm').style.display = 'block';
    document.getElementById('rechargeMemberBanner').innerHTML = `
        <div class="banner-avatar">${member.full_name.charAt(0)}</div>
        <div class="banner-info">
            <div class="name">${member.full_name}</div>
            <div class="code">${member.member_code}</div>
        </div>
        <div class="banner-balance">
            <div class="label">Saldo Actual</div>
            <div class="value">${member.balance.toLocaleString()} 🪙</div>
        </div>
    `;
    document.getElementById('rechargeAmount').value = '';
    document.getElementById('rechargeAmount').focus();
}

document.getElementById('rechargeAmount')?.addEventListener('input', () => {
    const amt = parseInt(document.getElementById('rechargeAmount').value) || 0;
    const rate = parseInt(CONFIG.exchange_rate) || 10;
    document.getElementById('rechargeEquivalent').textContent = `Equivalente: $${(amt * rate).toLocaleString()} MXN`;
    
    if (amt > 0 && selectedRechargeId) {
        document.getElementById('rechargeSummary').style.display = 'block';
        document.getElementById('rechargeSummary').innerHTML = `
            <h3>Resumen de Recarga</h3>
            <p>Miembro: <strong>${selectedRechargeId.name || selectedRechargeId.full_name}</strong> (${selectedRechargeId.code || selectedRechargeId.member_code})</p>
            <p>Saldo anterior: ${selectedRechargeId.balance.toLocaleString()} 🪙</p>
            <p>Recarga: <strong style="color:var(--success)">+${amt.toLocaleString()} 🪙</strong></p>
            <p>Nuevo saldo: <strong style="color:var(--primary)">${(selectedRechargeId.balance + amt).toLocaleString()} 🪙</strong></p>
            <p style="color:var(--on-surface-dim)">Monto recibido: $${(amt * rate).toLocaleString()} MXN</p>
        `;
    } else {
        document.getElementById('rechargeSummary').style.display = 'none';
    }
});

function setRechargeAmount(amt) {
    document.getElementById('rechargeAmount').value = amt;
    document.getElementById('rechargeAmount').dispatchEvent(new Event('input'));
}

async function confirmRecharge() {
    if (!selectedRechargeId) return;
    const amount = parseInt(document.getElementById('rechargeAmount').value);
    if (!amount || amount <= 0) { toast('Ingrese un monto válido', 'error'); return; }

    try {
        const data = await api('/transactions/recharge', 'POST', {
            member_id: selectedRechargeId.id,
            amount,
            description: document.getElementById('rechargeNote').value || undefined
        });
        toast(`✅ Recarga exitosa: +${amount}🪙 → ${data.transaction.member_name}`, 'success');
        cancelRecharge();
    } catch (err) { toast(err.message, 'error'); }
}

function cancelRecharge() {
    selectedRechargeId = null;
    document.getElementById('rechargeForm').style.display = 'none';
    document.getElementById('rechargeSearchResults').innerHTML = '';
    document.getElementById('rechargeSearch').value = '';
    document.getElementById('rechargeCardId').value = '';
}

// ============================================================
// CASHOUT
// ============================================================
document.getElementById('cashoutSearch').addEventListener('input', debounce(async () => {
    const val = document.getElementById('cashoutSearch').value;
    if (val.length < 2) { document.getElementById('cashoutSearchResults').innerHTML = ''; return; }
    try {
        const data = await api(`/members?search=${encodeURIComponent(val)}&limit=5`);
        document.getElementById('cashoutSearchResults').innerHTML = data.members.map(m => `
            <div class="search-result-item" onclick='showCashoutMember(${JSON.stringify({id:m.id,full_name:m.full_name,balance:m.balance,member_code:m.member_code})})'>
                <div class="result-name">${m.full_name}</div>
                <div class="result-info">${m.member_code} • ${m.balance} 🪙</div>
            </div>
        `).join('');
    } catch (err) { console.error(err); }
}, 300));

function showCashoutMember(member) {
    selectedCashoutId = member;
    document.getElementById('cashoutForm').style.display = 'block';
    document.getElementById('cashoutMemberBanner').innerHTML = `
        <div class="banner-avatar">${member.full_name.charAt(0)}</div>
        <div class="banner-info">
            <div class="name">${member.full_name}</div>
            <div class="code">${member.member_code}</div>
        </div>
        <div class="banner-balance">
            <div class="label">Saldo Disponible</div>
            <div class="value">${member.balance.toLocaleString()} 🪙</div>
        </div>
    `;
    document.getElementById('cashoutAmount').value = '';
    document.getElementById('cashoutAmount').focus();
}

document.getElementById('cashoutAmount')?.addEventListener('input', () => {
    const amt = parseInt(document.getElementById('cashoutAmount').value) || 0;
    const rate = parseInt(CONFIG.exchange_rate) || 10;
    document.getElementById('cashoutEquivalent').textContent = `Entregar al miembro: $${(amt * rate).toLocaleString()} MXN`;
});

async function confirmCashout() {
    if (!selectedCashoutId) return;
    const amount = parseInt(document.getElementById('cashoutAmount').value);
    if (!amount || amount <= 0) { toast('Ingrese un monto válido', 'error'); return; }

    try {
        const data = await api('/transactions/cashout', 'POST', {
            member_id: selectedCashoutId.id,
            amount
        });
        toast(`💵 Retiro: -${amount}🪙 → Entregar $${data.transaction.cash_to_return.toLocaleString()} MXN`, 'success');
        cancelCashout();
    } catch (err) { toast(err.message, 'error'); }
}

function cancelCashout() {
    selectedCashoutId = null;
    document.getElementById('cashoutForm').style.display = 'none';
    document.getElementById('cashoutSearchResults').innerHTML = '';
    document.getElementById('cashoutSearch').value = '';
}

// ============================================================
// HISTORY
// ============================================================
let historyPage = 1;

async function loadHistory() {
    try {
        let url = `/transactions?page=${historyPage}&limit=20`;
        const dateFrom = document.getElementById('historyDateFrom').value;
        const dateTo = document.getElementById('historyDateTo').value;
        const type = document.getElementById('historyType').value;
        const terminal = document.getElementById('historyTerminal').value;

        if (dateFrom) url += `&date_from=${dateFrom}`;
        if (dateTo) url += `&date_to=${dateTo}`;
        if (type) url += `&type=${type}`;
        if (terminal) url += `&terminal_id=${terminal}`;

        const data = await api(url);
        const tbody = document.getElementById('historyBody');

        tbody.innerHTML = data.transactions.map(tx => `
            <tr>
                <td>#${String(tx.id).padStart(4, '0')}</td>
                <td>${formatDateTime(tx.created_at)}</td>
                <td>${tx.member_name} <small style="color:var(--on-surface-dim)">${tx.member_code}</small></td>
                <td>${typeBadge(tx.type)}</td>
                <td><strong>${tx.type === 'purchase' || tx.type === 'cashout' ? '-' : '+'}${tx.amount} 🪙</strong></td>
                <td>${tx.balance_after} 🪙</td>
                <td>${tx.terminal_name || 'Servidor'}</td>
                <td>${tx.operator_name}</td>
                <td>${tx.type === 'purchase' && !tx.refund_of ? `<button class="btn-small" onclick="showRefund(${tx.id}, '${tx.member_name}', ${tx.amount})">🔄 Reembolso</button>` : '—'}</td>
            </tr>
        `).join('');

        renderPagination('historyPagination', data.pagination, (p) => { historyPage = p; loadHistory(); });

        // Load summary
        const summary = await api(`/transactions/summary${dateFrom ? `?date_from=${dateFrom}` : ''}${dateTo ? `&date_to=${dateTo}` : ''}`);
        document.getElementById('histRecharges').textContent = `+${(summary.summary.recharge?.total || 0).toLocaleString()} 🪙`;
        document.getElementById('histPurchases').textContent = `-${(summary.summary.purchase?.total || 0).toLocaleString()} 🪙`;
        document.getElementById('histRefunds').textContent = `+${(summary.summary.refund?.total || 0).toLocaleString()} 🪙`;
        document.getElementById('histCashouts').textContent = `-${(summary.summary.cashout?.total || 0).toLocaleString()} 🪙`;

        // Load terminal filter options
        const terms = await api('/terminals');
        const select = document.getElementById('historyTerminal');
        if (select.options.length <= 1) {
            terms.terminals.forEach(t => {
                const opt = document.createElement('option');
                opt.value = t.id;
                opt.text = t.name;
                select.add(opt);
            });
        }

    } catch (err) { toast(err.message, 'error'); }
}

// ============================================================
// REFUND
// ============================================================
let refundTxId = null;

function showRefund(txId, memberName, amount) {
    refundTxId = txId;
    document.getElementById('refundDetails').innerHTML = `
        <p>Transacción: <strong>#${String(txId).padStart(4, '0')}</strong></p>
        <p>Miembro: <strong>${memberName}</strong></p>
        <p>Monto a reembolsar: <strong style="color:var(--warning)">${amount} 🪙</strong></p>
    `;
    document.getElementById('refundReason').value = '';
    showModal('refundModal');
}

async function confirmRefund() {
    if (!refundTxId) return;
    const reason = document.getElementById('refundReason').value;
    if (!reason) { toast('Ingrese el motivo del reembolso', 'error'); return; }

    try {
        await api('/transactions/refund', 'POST', { transaction_id: refundTxId, reason });
        toast('🔄 Reembolso procesado exitosamente', 'success');
        hideModals();
        loadHistory();
    } catch (err) { toast(err.message, 'error'); }
}

// ============================================================
// TERMINALS
// ============================================================
async function loadTerminals() {
    try {
        const data = await api('/terminals');
        document.getElementById('terminalsGrid').innerHTML = data.terminals.map(t => {
            let shiftHtml = '';
            if (t.current_shift_id) {
                shiftHtml = `<div class="tc-shift" style="margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--surface-light); color: var(--primary);">
                                <strong>🛒 En Uso:</strong> ${t.operator_name}<br>
                                <small style="display:block; margin-bottom: 5px;">Desde: ${formatTime(t.shift_start)}</small>
                                <button class="btn-danger" style="padding: 4px 8px; font-size: 0.7rem; width: 100%; border-radius: 4px;" onclick="adminForceEndShift(${t.id})">
                                    <span class="material-symbols-rounded" style="font-size: 14px; margin-right: 4px; vertical-align: middle;">power_settings_new</span> Forzar Cierre
                                </button>
                             </div>`;
            }
            return `
            <div class="terminal-card ${t.connection_status}">
                <div class="tc-header">
                    <span class="tc-name">${t.name}</span>
                    <span class="tc-status"><span class="status-dot ${t.connection_status}"></span> ${t.connection_status === 'online' ? 'En línea' : t.connection_status === 'never' ? 'Nunca conectada' : 'Desconectada'}</span>
                </div>
                <div class="tc-meta">${t.location || 'Sin ubicación'} • ${t.product_count} productos</div>
                <div class="tc-token">Token: ${t.token}</div>
                <button class="btn-ghost" style="padding: 4px 8px; font-size: 0.75rem; width: 100%; margin-top: 8px;" onclick="showTerminalHistory(${t.id}, '${t.name.replace(/'/g, "\\'")}')">
                    <span class="material-symbols-rounded" style="font-size: 14px; vertical-align: middle;">history</span> Ver Historial
                </button>
                ${shiftHtml}
            </div>
            `;
        }).join('');
    } catch (err) { toast(err.message, 'error'); }
}

async function createTerminal() {
    try {
        await api('/terminals', 'POST', {
            name: document.getElementById('newTerminalName').value,
            location: document.getElementById('newTerminalLocation').value
        });
        hideModals();
        toast('Terminal creada', 'success');
        loadTerminals();
    } catch (err) { toast(err.message, 'error'); }
}

async function adminForceEndShift(terminalId) {
    if (!confirm('¿Estás seguro de forzar el cierre de turno en esta terminal? La sesión del vendedor se terminará de inmediato.')) return;
    try {
        await api(`/terminals/${terminalId}/end-shift`, 'POST', {});
        toast('Turno cerrado forzosamente', 'success');
        loadTerminals();
    } catch (err) { toast(err.message, 'error'); }
}

async function showTerminalHistory(terminalId, terminalName) {
    try {
        document.getElementById('historyModalTitle').innerText = `Historial: ${terminalName}`;
        document.getElementById('terminalHistoryBody').innerHTML = '<tr><td colspan="3" style="text-align:center;">Cargando historial...</td></tr>';
        showModal('terminalHistoryModal');
        
        const data = await api(`/terminals/events?limit=50&terminal_id=${terminalId}`);
        const tbody = document.getElementById('terminalHistoryBody');
        
        if (!data.events || data.events.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;">No hay actividad registrada.</td></tr>';
            return;
        }

        const eventsHtml = data.events.map(e => {
            const dateStr = new Date(e.created_at).toLocaleString('es-MX', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            let badgeClass = 'badge-neutral';
            if (e.event_type === 'shift_started' || e.event_type === 'online') badgeClass = 'badge-success';
            if (e.event_type === 'shift_ended' || e.event_type === 'offline') badgeClass = 'badge-danger';
            
            return `
            <tr>
                <td style="font-size: 0.85rem">${dateStr}</td>
                <td>${e.operator_name || 'Sistema'}</td>
                <td><span class="badge ${badgeClass}">${e.event_type}</span><br><small>${e.message || ''}</small></td>
            </tr>
            `;
        }).join('');
        tbody.innerHTML = eventsHtml;
    } catch (err) { toast(err.message, 'error'); hideModals(); }
}

// ============================================================
// PRODUCTS
// ============================================================
async function loadProducts() {
    try {
        const termFilter = document.getElementById('productTerminalFilter')?.value;
        let url = '/products';
        if (termFilter) url += `?terminal_id=${termFilter}`;

        const data = await api(url);
        document.getElementById('productsBody').innerHTML = data.products.map(p => `
            <tr>
                <td><strong>${p.image_url || '📦'} ${p.name}</strong></td>
                <td><span class="cacaos-val">${p.price} 🪙</span></td>
                <td><span class="badge badge-outline">${p.category}</span></td>
                <td><span class="badge ${p.terminal_id ? 'badge-info' : 'badge-success'}">${p.terminal_name || '🌍 TODAS (Global)'}</span></td>
                <td><button class="btn-small" onclick="deleteProduct(${p.id})">Eliminar</button></td>
            </tr>
        `).join('');

        // Load terminal options
        const terms = await api('/terminals');
        const select = document.getElementById('productTerminalFilter');
        const modalSelect = document.getElementById('newProductTerminal');
        if (select.options.length <= 1) {
            terms.terminals.forEach(t => {
                select.add(new Option(t.name, t.id));
                modalSelect.add(new Option(t.name, t.id));
            });
        }
    } catch (err) { toast(err.message, 'error'); }
}

// ============================================================
// RECHARGES (NFC)
// ============================================================
let activeRechargeMemberId = null;

async function lookupCardForRecharge() {
    const cardUid = document.getElementById('rechargeCardId').value.trim();
    if (!cardUid) {
        toast('Ingrese un ID de tarjeta válido', 'error');
        return;
    }

    try {
        const idData = await api(`/members/identify?card_uid=${cardUid}`);
        if (!idData.member) throw new Error('Tarjeta no asociada a ningún miembro');

        const m = idData.member;
        activeRechargeMemberId = m.id;

        // Show name only (No balance per user request)
        document.getElementById('rechargeMemberNameDisplay').textContent = m.full_name;
        document.getElementById('rechargeMemberBanner').style.display = 'block';

        // Unlock Right panel
        const rForm = document.getElementById('rechargeForm');
        rForm.style.opacity = '1';
        rForm.style.pointerEvents = 'auto';

        // Reset amount
        setRechargeAmount(0);

    } catch (err) {
        toast(err.message, 'error');
        cancelRecharge();
    }
}

function updateRechargeEquivalent() {
    const input = document.getElementById('rechargeAmount');
    let val = parseInt(input.value) || 0;
    if (val < 0) val = 0;
    
    // Fallback rate to 10 if CONFIG isn't loaded
    const rate = (typeof CONFIG !== 'undefined' && CONFIG.exchange_rate) ? parseInt(CONFIG.exchange_rate) : 10;
    document.getElementById('rechargeEquivalent').textContent = `Equivalente: $${(val * rate).toLocaleString()} MXN`;
}

function setRechargeAmount(amt) {
    const input = document.getElementById('rechargeAmount');
    input.value = amt;
    updateRechargeEquivalent();
}

function addRechargeAmount(amt) {
    const input = document.getElementById('rechargeAmount');
    let current = parseInt(input.value) || 0;
    input.value = current + amt;
    updateRechargeEquivalent();
}

// Listen to manual input
document.getElementById('rechargeAmount')?.addEventListener('input', updateRechargeEquivalent);

async function confirmRecharge() {
    if (!activeRechargeMemberId) return;
    
    const amount = parseInt(document.getElementById('rechargeAmount').value) || 0;
    if (amount <= 0) {
        toast('Ingrese un monto mayor a 0', 'error');
        return;
    }

    const note = document.getElementById('rechargeNote').value.trim();
    
    // Disable button safely to prevent double clicks
    const btn = document.getElementById('confirmRechargeBtn');
    if (btn.disabled) return;
    btn.disabled = true;
    
    try {
        await api('/transactions/recharge', 'POST', {
            member_id: activeRechargeMemberId,
            amount: amount,
            description: note || 'Recarga de Cacaos por Admin'
        });
        
        toast(`✅ Se recargaron ${amount} Cacaos exitosamente`, 'success');
        
        // Reset the UI cleanly
        cancelRecharge();
        document.getElementById('rechargeCardId').value = '';
    } catch (err) {
        toast(err.message, 'error');
    } finally {
        btn.disabled = false;
    }
}

function cancelRecharge() {
    activeRechargeMemberId = null;
    document.getElementById('rechargeMemberBanner').style.display = 'none';
    document.getElementById('rechargeMemberNameDisplay').textContent = '';
    
    const rForm = document.getElementById('rechargeForm');
    rForm.style.opacity = '0.5';
    rForm.style.pointerEvents = 'none';
    
    setRechargeAmount(0);
    document.getElementById('rechargeNote').value = '';
}

async function createProduct() {
    try {
        await api('/products', 'POST', {
            name: document.getElementById('newProductName').value,
            price: parseInt(document.getElementById('newProductPrice').value),
            category: document.getElementById('newProductCategory').value || 'General',
            image_url: document.getElementById('newProductIcon').value || '📦',
            terminal_id: document.getElementById('newProductTerminal').value || null
        });
        hideModals();
        toast('Producto creado', 'success');
        loadProducts();
    } catch (err) { toast(err.message, 'error'); }
}

async function deleteProduct(id) {
    if (!confirm('¿Eliminar este producto?')) return;
    try {
        await api(`/products/${id}`, 'DELETE');
        toast('Producto eliminado', 'success');
        loadProducts();
    } catch (err) { toast(err.message, 'error'); }
}

// ============================================================
// OPERATORS
// ============================================================
async function loadOperators() {
    try {
        const data = await api('/operators');
        document.getElementById('operatorsBody').innerHTML = data.operators.map(o => `
            <tr>
                <td><strong>${o.username}</strong></td>
                <td>${o.full_name}</td>
                <td><span class="badge badge-${o.role}">${o.role === 'admin' ? '👑 Admin' : '🛒 Vendedor'}</span></td>
                <td><span class="badge badge-${o.status}">${o.status === 'active' ? '🟢 Activo' : '🔴 Inactivo'}</span></td>
                <td>—</td>
            </tr>
        `).join('');
    } catch (err) { toast(err.message, 'error'); }
}

async function createOperator() {
    try {
        await api('/operators', 'POST', {
            username: document.getElementById('newOpUsername').value,
            full_name: document.getElementById('newOpName').value,
            password: document.getElementById('newOpPassword').value,
            role: document.getElementById('newOpRole').value
        });
        hideModals();
        toast('Operador creado', 'success');
        loadOperators();
    } catch (err) { toast(err.message, 'error'); }
}

// ============================================================
// MODALS
// ============================================================
function showModal(id) {
    document.getElementById('modalOverlay').style.display = 'flex';
    document.getElementById(id).style.display = 'block';
}

function hideModals() {
    document.getElementById('modalOverlay').style.display = 'none';
    document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
}

function closeModal(e) {
    if (e.target === document.getElementById('modalOverlay')) hideModals();
}

// ============================================================
// EXPORT
// ============================================================
async function exportHistory() {
    try {
        const data = await api('/transactions?limit=9999');
        let csv = 'ID,Fecha,Miembro,Código,Tipo,Monto,Saldo_Después,Terminal,Operador\n';
        data.transactions.forEach(tx => {
            csv += `${tx.id},${tx.created_at},${tx.member_name},${tx.member_code},${tx.type},${tx.amount},${tx.balance_after},${tx.terminal_name||'Servidor'},${tx.operator_name}\n`;
        });
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `cacaos_historial_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        toast('Historial exportado', 'success');
    } catch (err) { toast(err.message, 'error'); }
}

// ============================================================
// UTILITIES
// ============================================================
function typeBadge(type) {
    const map = {
        recharge: ['🟢 Recarga', 'badge-recharge'],
        purchase: ['🔵 Compra', 'badge-purchase'],
        refund: ['🟠 Reembolso', 'badge-refund'],
        cashout: ['🔴 Retiro', 'badge-cashout']
    };
    const [label, cls] = map[type] || [type, ''];
    return `<span class="badge ${cls}">${label}</span>`;
}

function formatTime(dt) {
    if (!dt) return '—';
    return new Date(dt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(dt) {
    if (!dt) return '—';
    const d = new Date(dt);
    return `${d.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`;
}

function toast(msg, type = 'info') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = `toast ${type} show`;
    setTimeout(() => el.classList.remove('show'), 3500);
}

function debounce(fn, ms) {
    let timer;
    return function(...args) { clearTimeout(timer); timer = setTimeout(() => fn.apply(this, args), ms); };
}

function renderPagination(containerId, pagination, callback) {
    const el = document.getElementById(containerId);
    if (pagination.pages <= 1) { el.innerHTML = ''; return; }
    let html = '';
    for (let i = 1; i <= pagination.pages; i++) {
        html += `<button class="page-btn ${i === pagination.page ? 'active' : ''}" onclick="(${callback.name || callback})(${i})">${i}</button>`;
    }
    el.innerHTML = html;
}

// ============================================================
// ALERTS / SYSTEM NOTIFICATIONS
// ============================================================
async function loadAlerts() {
    try {
        const tId = document.getElementById('alertTerminalFilter').value.trim();
        let url = '/terminals/events?limit=50';
        if (tId) url += `&terminal_id=${tId}`;

        const data = await api(url);
        const tbody = document.getElementById('alertsTableBody');
        
        if (data.events.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:2rem;">Sin eventos recientes</td></tr>';
            return;
        }

        tbody.innerHTML = data.events.map(ev => {
            let color = '';
            if (ev.event_type === 'offline') color = 'color: var(--danger); font-weight: 600;';
            if (ev.event_type === 'online') color = 'color: var(--success); font-weight: 600;';
            
            let icon = 'info';
            if (ev.event_type === 'online') icon = 'wifi';
            if (ev.event_type === 'offline') icon = 'wifi_off';
            if (ev.event_type === 'shift_started') icon = 'play_arrow';
            if (ev.event_type === 'shift_ended') icon = 'stop';

            return `
            <tr>
                <td>${formatDateTime(ev.created_at)}</td>
                <td><strong>${ev.terminal_name}</strong> (ID: ${ev.terminal_id})</td>
                <td style="${color}">
                    <span class="material-symbols-rounded" style="vertical-align:bottom;font-size:1.1rem;">${icon}</span> 
                    ${ev.event_type.toUpperCase()}
                </td>
                <td>${ev.message || ''}</td>
                <td>${ev.operator_name || '—'}</td>
            </tr>
        `}).join('');
    } catch (err) {
        toast('Error al cargar alertas', 'error');
    }
}

function filterAlerts() {
    loadAlerts();
}

// ============================================================
// INIT
// ============================================================
if (TOKEN && OPERATOR) {
    showApp();
} else {
    document.getElementById('loginScreen').style.display = 'flex';
}

// Set today's date for history filters
const today = new Date().toISOString().split('T')[0];
document.getElementById('historyDateFrom').value = today;
document.getElementById('historyDateTo').value = today;
