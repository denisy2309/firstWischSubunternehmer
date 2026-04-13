// ============================================================================
// KONFIGURATION - Bitte anpassen
// ============================================================================
const CONFIG = {
    supabaseUrl: 'IHRE_SUPABASE_URL',           // z.B. 'https://xxxxx.supabase.co'
    supabaseKey: 'IHRE_SUPABASE_ANON_KEY',      // Supabase Anon Key
    masterCode: 'MASTER_CODE_HIER',             // Master-Zugangscode
    n8nWebhookUrl: 'IHRE_N8N_WEBHOOK_URL'       // n8n Webhook für Ablehnungen
};

// ============================================================================
// GLOBALE VARIABLEN
// ============================================================================
let supabase;
let currentUser = null;
let currentStatus = null;
let currentOrder = null;
let allOrders = [];
let signaturePad = null;
let realtimeChannel = null;

// ============================================================================
// INITIALISIERUNG
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
    initSupabase();
    checkStoredLogin();
    setupSignaturePad();
    setupEnterKeyLogin();
});

function initSupabase() {
    supabase = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);
}

function setupEnterKeyLogin() {
    const accessCodeInput = document.getElementById('accessCode');
    if (accessCodeInput) {
        accessCodeInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                login();
            }
        });
    }
}

// ============================================================================
// AUTHENTIFIZIERUNG
// ============================================================================
function checkStoredLogin() {
    const storedCode = localStorage.getItem('accessCode');
    if (storedCode) {
        document.getElementById('accessCode').value = storedCode;
        login();
    }
}

async function login() {
    const code = document.getElementById('accessCode').value.trim();
    
    if (!code) {
        alert('Bitte geben Sie einen Zugangscode ein');
        return;
    }

    // Check if master code
    if (code === CONFIG.masterCode) {
        currentUser = {
            code: code,
            name: 'Master',
            isMaster: true,
            tableName: null
        };
        localStorage.setItem('accessCode', code);
        showMasterView();
        return;
    }

    // Check subcontractor code in database
    // Annahme: Sie haben eine Tabelle 'contractors' mit Feldern: code, name, table_name
    const { data, error } = await supabase
        .from('contractors')
        .select('*')
        .eq('code', code)
        .single();

    if (error || !data) {
        alert('Ungültiger Zugangscode');
        console.error('Login error:', error);
        return;
    }

    currentUser = {
        code: code,
        name: data.name,
        isMaster: false,
        tableName: data.table_name
    };

    localStorage.setItem('accessCode', code);
    showStatusView();
}

function logout() {
    if (!confirm('Möchten Sie sich wirklich abmelden?')) {
        return;
    }
    
    localStorage.removeItem('accessCode');
    currentUser = null;
    
    if (realtimeChannel) {
        supabase.removeChannel(realtimeChannel);
        realtimeChannel = null;
    }
    
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('mainApp').classList.add('hidden');
    document.getElementById('accessCode').value = '';
    
    // Reset views
    document.getElementById('masterView').classList.add('hidden');
    document.getElementById('statusView').classList.add('hidden');
    document.getElementById('ordersView').classList.add('hidden');
}

// ============================================================================
// MASTER VIEW
// ============================================================================
async function showMasterView() {
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('mainApp').classList.remove('hidden');
    document.getElementById('userName').textContent = currentUser.name;
    document.getElementById('masterView').classList.remove('hidden');
    document.getElementById('statusView').classList.add('hidden');
    document.getElementById('ordersView').classList.add('hidden');

    // Load all contractors
    const { data: contractors, error } = await supabase
        .from('contractors')
        .select('*')
        .order('name');

    if (error) {
        console.error('Error loading contractors:', error);
        alert('Fehler beim Laden der Subunternehmer');
        return;
    }

    const contractorList = document.getElementById('contractorList');
    contractorList.innerHTML = '';

    if (!contractors || contractors.length === 0) {
        contractorList.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">👥</div>
                <div class="empty-text">Keine Subunternehmer gefunden</div>
            </div>
        `;
        return;
    }

    for (const contractor of contractors) {
        const stats = await getContractorStats(contractor.table_name);
        
        const card = document.createElement('div');
        card.className = 'contractor-card';
        card.onclick = () => selectContractor(contractor);
        card.innerHTML = `
            <div class="contractor-name">${escapeHtml(contractor.name)}</div>
            <div class="contractor-stats">
                <div class="stat">
                    <div class="stat-value" style="color: var(--primary);">${stats.open}</div>
                    <div class="stat-label">Offen</div>
                </div>
                <div class="stat">
                    <div class="stat-value" style="color: var(--success);">${stats.completed}</div>
                    <div class="stat-label">Erledigt</div>
                </div>
                <div class="stat">
                    <div class="stat-value" style="color: var(--danger);">${stats.rejected}</div>
                    <div class="stat-label">Abgelehnt</div>
                </div>
            </div>
        `;
        contractorList.appendChild(card);
    }
}

async function getContractorStats(tableName) {
    try {
        const { data, error } = await supabase
            .from(tableName)
            .select('status');

        if (error) {
            console.error('Error getting stats:', error);
            return { open: 0, completed: 0, rejected: 0 };
        }

        const stats = {
            open: data.filter(o => o.status === 'Offen').length,
            completed: data.filter(o => o.status === 'Erledigt').length,
            rejected: data.filter(o => o.status === 'Abgelehnt').length
        };

        return stats;
    } catch (e) {
        console.error('Stats error:', e);
        return { open: 0, completed: 0, rejected: 0 };
    }
}

function selectContractor(contractor) {
    currentUser.tableName = contractor.table_name;
    currentUser.selectedContractorName = contractor.name;
    showStatusView();
}

// ============================================================================
// STATUS VIEW
// ============================================================================
async function showStatusView() {
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('mainApp').classList.remove('hidden');
    document.getElementById('masterView').classList.add('hidden');
    document.getElementById('statusView').classList.remove('hidden');
    document.getElementById('ordersView').classList.add('hidden');

    if (currentUser.isMaster && currentUser.selectedContractorName) {
        document.getElementById('userName').textContent = `Master → ${currentUser.selectedContractorName}`;
    } else {
        document.getElementById('userName').textContent = currentUser.name;
    }

    await loadOrders();
    updateStatusCounts();
    setupRealtime();
}

async function loadOrders() {
    try {
        const { data, error } = await supabase
            .from(currentUser.tableName)
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error loading orders:', error);
            alert('Fehler beim Laden der Aufträge');
            return;
        }

        allOrders = data || [];
        updateStatusCounts();
    } catch (e) {
        console.error('Load orders error:', e);
        allOrders = [];
    }
}

function updateStatusCounts() {
    const counts = {
        open: allOrders.filter(o => o.status === 'Offen').length,
        completed: allOrders.filter(o => o.status === 'Erledigt').length,
        rejected: allOrders.filter(o => o.status === 'Abgelehnt').length
    };

    document.getElementById('countOpen').textContent = counts.open;
    document.getElementById('countCompleted').textContent = counts.completed;
    document.getElementById('countRejected').textContent = counts.rejected;
}

// ============================================================================
// REALTIME UPDATES
// ============================================================================
function setupRealtime() {
    // Remove existing channel if any
    if (realtimeChannel) {
        supabase.removeChannel(realtimeChannel);
    }

    // Subscribe to table changes
    realtimeChannel = supabase
        .channel(`orders_${currentUser.tableName}`)
        .on('postgres_changes', 
            { 
                event: '*', 
                schema: 'public', 
                table: currentUser.tableName 
            }, 
            (payload) => {
                console.log('Realtime update:', payload);
                handleRealtimeUpdate(payload);
            }
        )
        .subscribe();
}

async function handleRealtimeUpdate(payload) {
    if (payload.eventType === 'INSERT') {
        allOrders.unshift(payload.new);
    } else if (payload.eventType === 'UPDATE') {
        const index = allOrders.findIndex(o => o.id === payload.new.id);
        if (index !== -1) {
            allOrders[index] = payload.new;
        }
    } else if (payload.eventType === 'DELETE') {
        allOrders = allOrders.filter(o => o.id !== payload.old.id);
    }

    updateStatusCounts();
    
    // Refresh current view if in orders list
    if (!document.getElementById('ordersView').classList.contains('hidden')) {
        displayOrders(currentStatus);
    }
}

// ============================================================================
// ORDERS VIEW
// ============================================================================
function showOrders(status) {
    currentStatus = status;
    document.getElementById('statusView').classList.add('hidden');
    document.getElementById('ordersView').classList.remove('hidden');
    document.getElementById('ordersTitle').textContent = `${status}e Aufträge`;
    displayOrders(status);
}

function displayOrders(status) {
    const ordersList = document.getElementById('ordersList');
    const filteredOrders = allOrders.filter(o => o.status === status);

    if (filteredOrders.length === 0) {
        ordersList.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📭</div>
                <div class="empty-text">Keine ${status.toLowerCase()}en Aufträge vorhanden</div>
            </div>
        `;
        return;
    }

    ordersList.innerHTML = '';

    filteredOrders.forEach(order => {
        const card = createOrderCard(order, status);
        ordersList.appendChild(card);
    });
}

function createOrderCard(order, status) {
    const card = document.createElement('div');
    card.className = 'order-card';
    
    const services = parseServices(order.services);
    const servicesHtml = services.map(s => `
        <div class="service-item">${escapeHtml(s)}</div>
    `).join('');

    let actionsHtml = '';
    if (status === 'Offen') {
        actionsHtml = `
            <div class="order-actions">
                <button class="btn btn-danger" onclick="rejectOrder(${order.id})">Ablehnen</button>
                <button class="btn btn-success" onclick="openCompletionModal(${order.id})">Bearbeiten</button>
            </div>
        `;
    }

    card.innerHTML = `
        <div class="order-header">
            <div class="order-id">Auftrag #${order.id}</div>
            <div class="order-date">${formatDate(order.created_at)}</div>
        </div>
        <div class="order-details">
            <div class="detail-item">
                <div class="detail-label">Kunde</div>
                <div class="detail-value">${escapeHtml(order.customer_name || 'N/A')}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Adresse</div>
                <div class="detail-value">${escapeHtml(order.customer_address || 'N/A')}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Telefon</div>
                <div class="detail-value">${escapeHtml(order.customer_phone || 'N/A')}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Termin</div>
                <div class="detail-value">${escapeHtml(order.appointment_date || 'N/A')}</div>
            </div>
        </div>
        <div class="order-services">
            <div class="detail-label" style="margin-bottom: 0.5rem;">Gebuchte Dienstleistungen</div>
            ${servicesHtml}
        </div>
        ${actionsHtml}
    `;

    return card;
}

function backToStatus() {
    if (currentUser.isMaster && currentUser.selectedContractorName) {
        if (confirm('Zurück zur Subunternehmer-Übersicht?')) {
            currentUser.tableName = null;
            currentUser.selectedContractorName = null;
            showMasterView();
            return;
        }
    }
    
    document.getElementById('ordersView').classList.add('hidden');
    document.getElementById('statusView').classList.remove('hidden');
}

// ============================================================================
// ORDER ACTIONS
// ============================================================================
async function rejectOrder(orderId) {
    if (!confirm('Möchten Sie diesen Auftrag wirklich ablehnen?')) {
        return;
    }

    try {
        const { error } = await supabase
            .from(currentUser.tableName)
            .update({ status: 'Abgelehnt' })
            .eq('id', orderId);

        if (error) {
            alert('Fehler beim Ablehnen des Auftrags');
            console.error(error);
            return;
        }

        // Send notification via n8n
        const order = allOrders.find(o => o.id === orderId);
        if (order && CONFIG.n8nWebhookUrl && CONFIG.n8nWebhookUrl !== 'IHRE_N8N_WEBHOOK_URL') {
            try {
                await fetch(CONFIG.n8nWebhookUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        orderId: orderId,
                        customerEmail: order.customer_email,
                        customerName: order.customer_name,
                        status: 'rejected',
                        contractorName: currentUser.name
                    })
                });
            } catch (e) {
                console.error('n8n notification error:', e);
            }
        }
    } catch (e) {
        console.error('Reject order error:', e);
        alert('Fehler beim Ablehnen des Auftrags');
    }
}

function openCompletionModal(orderId) {
    currentOrder = allOrders.find(o => o.id === orderId);
    
    if (!currentOrder) {
        alert('Auftrag nicht gefunden');
        return;
    }

    const services = parseServices(currentOrder.services);
    const servicesHtml = services.map(s => `
        <div class="service-item">${escapeHtml(s)}</div>
    `).join('');

    document.getElementById('modalServices').innerHTML = servicesHtml;
    document.getElementById('confirmServices').checked = false;
    clearSignature();
    document.getElementById('completionModal').classList.add('active');
}

function closeModal() {
    document.getElementById('completionModal').classList.remove('active');
    currentOrder = null;
}

async function completeOrder() {
    if (!document.getElementById('confirmServices').checked) {
        alert('Bitte bestätigen Sie, dass alle Dienstleistungen durchgeführt wurden');
        return;
    }

    if (!signaturePad.hasSignature) {
        alert('Bitte lassen Sie den Kunden unterschreiben');
        return;
    }

    try {
        const signatureData = signaturePad.canvas.toDataURL();

        const { error } = await supabase
            .from(currentUser.tableName)
            .update({ 
                status: 'Erledigt',
                signature: signatureData,
                completed_at: new Date().toISOString()
            })
            .eq('id', currentOrder.id);

        if (error) {
            alert('Fehler beim Abschließen des Auftrags');
            console.error(error);
            return;
        }

        closeModal();
    } catch (e) {
        console.error('Complete order error:', e);
        alert('Fehler beim Abschließen des Auftrags');
    }
}

// ============================================================================
// SIGNATURE PAD
// ============================================================================
function setupSignaturePad() {
    const canvas = document.getElementById('signatureCanvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    
    // Set canvas size
    canvas.width = canvas.offsetWidth;
    canvas.height = 200;

    let isDrawing = false;
    let lastX = 0;
    let lastY = 0;

    function getCoordinates(e) {
        const rect = canvas.getBoundingClientRect();
        const clientX = e.clientX || (e.touches && e.touches[0] && e.touches[0].clientX);
        const clientY = e.clientY || (e.touches && e.touches[0] && e.touches[0].clientY);
        const x = clientX - rect.left;
        const y = clientY - rect.top;
        return { x, y };
    }

    function startDrawing(e) {
        isDrawing = true;
        const coords = getCoordinates(e);
        lastX = coords.x;
        lastY = coords.y;
        signaturePad.hasSignature = true;
        e.preventDefault();
    }

    function draw(e) {
        if (!isDrawing) return;
        
        const coords = getCoordinates(e);
        
        ctx.strokeStyle = '#111827';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        ctx.beginPath();
        ctx.moveTo(lastX, lastY);
        ctx.lineTo(coords.x, coords.y);
        ctx.stroke();
        
        lastX = coords.x;
        lastY = coords.y;
        e.preventDefault();
    }

    function stopDrawing() {
        isDrawing = false;
    }

    // Mouse events
    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseout', stopDrawing);

    // Touch events
    canvas.addEventListener('touchstart', startDrawing);
    canvas.addEventListener('touchmove', draw);
    canvas.addEventListener('touchend', stopDrawing);

    signaturePad = {
        canvas: canvas,
        ctx: ctx,
        hasSignature: false
    };
}

function clearSignature() {
    if (!signaturePad) return;
    
    const canvas = signaturePad.canvas;
    const ctx = signaturePad.ctx;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    signaturePad.hasSignature = false;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================
function formatDate(dateString) {
    if (!dateString) return 'N/A';
    
    try {
        const date = new Date(dateString);
        return date.toLocaleDateString('de-DE', { 
            year: 'numeric', 
            month: '2-digit', 
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch (e) {
        return dateString;
    }
}

function parseServices(services) {
    if (Array.isArray(services)) {
        return services;
    }
    
    if (typeof services === 'string') {
        try {
            const parsed = JSON.parse(services);
            return Array.isArray(parsed) ? parsed : [services];
        } catch (e) {
            return [services];
        }
    }
    
    return [];
}

function escapeHtml(text) {
    if (!text) return '';
    
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
