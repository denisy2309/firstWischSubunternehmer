// Wrapper to prevent global scope conflicts
(function() {
'use strict';

// ============================================================================
// KONFIGURATION - Bitte anpassen
// ============================================================================
const CONFIG = {
    apiUrl: 'https://uncastigated-niels-greatly.ngrok-free.dev',  // Deine ngrok URL (OHNE /api am Ende)
    pollingInterval: 5000  // Polling alle 5 Sekunden für Updates
};

// ============================================================================
// GLOBALE VARIABLEN
// ============================================================================
let currentUser = null;
let currentStatus = null;
let currentOrder = null;
let allOrders = [];
let signaturePad = null;
let pollingTimer = null;
let lastUpdateTimestamp = null;

// ============================================================================
// CUSTOM ALERT/CONFIRM SYSTEM
// ============================================================================

/**
 * Zeigt eine eigene Alert-Nachricht
 * @param {string} message - Die Nachricht
 * @param {string} title - Der Titel (optional)
 * @param {string} type - Der Typ der Meldung (error, success, warning, info)
 */
function customAlert(message, title = 'Hinweis', type = 'info') {
    return new Promise((resolve) => {
        const modal = document.getElementById('customAlertModal');
        const titleEl = document.getElementById('alertTitle');
        const messageEl = document.getElementById('alertMessage');
        const footerEl = document.getElementById('alertFooter');

        // Icon basierend auf Typ
        const icons = {
            error: '❌',
            success: '✅',
            warning: '⚠️',
            info: 'ℹ️'
        };

        titleEl.innerHTML = `${icons[type] || icons.info} ${title}`;
        messageEl.textContent = message;
        modal.setAttribute('data-type', type);
        
        footerEl.innerHTML = `
            <button class="btn btn-primary" id="alertOkBtn" style="width: 100%;">OK</button>
        `;

        modal.classList.add('active');

        const okBtn = document.getElementById('alertOkBtn');
        const closeAlert = () => {
            modal.classList.remove('active');
            modal.removeAttribute('data-type');
            resolve();
        };

        okBtn.onclick = closeAlert;
    });
}

/**
 * Zeigt eine eigene Confirm-Nachricht
 * @param {string} message - Die Nachricht
 * @param {string} title - Der Titel (optional)
 * @returns {Promise<boolean>} - true wenn bestätigt, false wenn abgebrochen
 */
function customConfirm(message, title = 'Bestätigung', type = 'warning') {
    return new Promise((resolve) => {
        const modal = document.getElementById('customAlertModal');
        const titleEl = document.getElementById('alertTitle');
        const messageEl = document.getElementById('alertMessage');
        const footerEl = document.getElementById('alertFooter');

        // Icon basierend auf Typ
        const icons = {
            error: '❌',
            success: '✅',
            warning: '⚠️',
            info: 'ℹ️'
        };

        titleEl.innerHTML = `${icons[type] || icons.info} ${title}`;
        messageEl.textContent = message;
        modal.setAttribute('data-type', type);
        
        footerEl.innerHTML = `
            <button class="btn btn-secondary" id="alertCancelBtn">Abbrechen</button>
            <button class="btn btn-primary" id="alertConfirmBtn">Bestätigen</button>
        `;

        modal.classList.add('active');

        const confirmBtn = document.getElementById('alertConfirmBtn');
        const cancelBtn = document.getElementById('alertCancelBtn');
        
        const closeWithResult = (result) => {
            modal.classList.remove('active');
            modal.removeAttribute('data-type');
            resolve(result);
        };

        confirmBtn.onclick = () => closeWithResult(true);
        cancelBtn.onclick = () => closeWithResult(false);
        
        // ESC-Taste für Abbrechen
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                closeWithResult(false);
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
    });
}

// ============================================================================
// INITIALISIERUNG
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
    checkStoredLogin();
    setupSignaturePad();
    setupEventListeners();
});

function setupEventListeners() {
    // Login
    const loginBtn = document.getElementById('loginBtn');
    if (loginBtn) loginBtn.addEventListener('click', login);
    
    const accessCodeInput = document.getElementById('accessCode');
    if (accessCodeInput) {
        accessCodeInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') login();
        });
    }
    
    // Logout
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);
    
    // Back button
    const backBtn = document.getElementById('backBtn');
    if (backBtn) backBtn.addEventListener('click', backToStatus);

    const backToMasterBtn = document.getElementById('backToMasterBtn');
    if (backToMasterBtn) backToMasterBtn.addEventListener('click', backToMaster);
    
    // Status cards
    document.querySelectorAll('.status-card').forEach(card => {
        card.addEventListener('click', function() {
            const status = this.getAttribute('data-status');
            if (status === 'open') showOrders('Offen');
            else if (status === 'completed') showOrders('Erledigt');
            else if (status === 'rejected') showOrders('Abgelehnt');
        });
    });
    
    // Modal
    const modalOverlay = document.querySelector('.modal-overlay');
    if (modalOverlay) modalOverlay.addEventListener('click', closeModal);
    
    const modalCloseBtn = document.getElementById('modalCloseBtn');
    if (modalCloseBtn) modalCloseBtn.addEventListener('click', closeModal);
    
    const modalCancelBtn = document.getElementById('modalCancelBtn');
    if (modalCancelBtn) modalCancelBtn.addEventListener('click', closeModal);
    
    const completeOrderBtn = document.getElementById('completeOrderBtn');
    if (completeOrderBtn) completeOrderBtn.addEventListener('click', completeOrder);
    
    const clearSignatureBtn = document.getElementById('clearSignatureBtn');
    if (clearSignatureBtn) clearSignatureBtn.addEventListener('click', clearSignature);
}

// ============================================================================
// API HELPER FUNCTIONS
// ============================================================================
async function apiCall(endpoint, options = {}) {
    try {
        const url = `${CONFIG.apiUrl}/api${endpoint}`;
        const response = await fetch(url, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                'ngrok-skip-browser-warning': 'true',  // Bypass ngrok warning
                ...options.headers
            }
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'API Fehler');
        }

        return data;
    } catch (error) {
        console.error('API Call error:', error);
        throw error;
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
        await customAlert('Bitte geben Sie einen Zugangscode ein', 'Hinweis', 'warning');
        return;
    }

    try {
        const result = await apiCall('/login', {
            method: 'POST',
            body: JSON.stringify({ code })
        });

        if (result.success) {
            currentUser = result.user;
            localStorage.setItem('accessCode', code);

            if (currentUser.isMaster) {
                showMasterView();
            } else {
                showStatusView();
            }
        }
    } catch (error) {
        await customAlert('Ungültiger Zugangscode!', 'Anmeldefehler', 'error');
        console.error('Login error:', error);
    }
}

async function logout() {
    const confirmed = await customConfirm('Möchten Sie sich wirklich abmelden?', 'Abmelden', 'info');
    if (!confirmed) {
        return;
    }
    
    localStorage.removeItem('accessCode');
    currentUser = null;
    stopPolling();
    
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

    try {
        const result = await apiCall('/contractors');
        const contractors = result.data;
        console.log(contractors);

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
            console.log("Tabelle: ", contractor.Auftragstabelle);
            const statsResult = await apiCall(`/contractors/${contractor.Auftragstabelle}/stats`);
            const stats = statsResult.stats;
            console.log(stats);
            
            const card = document.createElement('div');
            card.className = 'contractor-card';
            card.innerHTML = `
                <div class="contractor-name">${escapeHtml(contractor.Name)}</div>
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
            card.addEventListener('click', () => selectContractor(contractor));
            contractorList.appendChild(card);
        }
    } catch (error) {
        console.error('Error loading contractors:', error);
        await customAlert('Fehler beim Laden der Subunternehmer', 'Fehler', 'error');
    }
}

function selectContractor(contractor) {
    currentUser.tableName = contractor.Auftragstabelle;
    currentUser.selectedContractorName = contractor.Name;
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

    const statusViewBackBtn = document.getElementById('statusViewBackBtn');
    if (statusViewBackBtn) {
        statusViewBackBtn.style.display = currentUser.isMaster ? 'flex' : 'none';
    }

    if (currentUser.isMaster && currentUser.selectedContractorName) {
        document.getElementById('userName').textContent = `Master → ${currentUser.selectedContractorName}`;
    } else {
        document.getElementById('userName').textContent = currentUser.name;
    }

    await loadOrders();
    updateStatusCounts();
    startPolling();
}

async function loadOrders() {
    try {
        console.log("Current User: ", currentUser);
        const result = await apiCall(`/orders/${currentUser.tableName}`);
        allOrders = result.data || [];
        updateStatusCounts();
    } catch (error) {
        console.error('Error loading orders:', error);
        await customAlert('Fehler beim Laden der Aufträge', 'Fehler', 'error');
        allOrders = [];
    }
}

function updateStatusCounts() {
    const counts = {
        open: allOrders.filter(o => o.Status === 'Offen').length,
        completed: allOrders.filter(o => o.Status === 'Erledigt').length,
        rejected: allOrders.filter(o => o.Status === 'Abgelehnt').length
    };

    document.getElementById('countOpen').textContent = counts.open;
    document.getElementById('countCompleted').textContent = counts.completed;
    document.getElementById('countRejected').textContent = counts.rejected;
}

// ============================================================================
// POLLING FÜR ECHTZEIT-UPDATES
// ============================================================================
function startPolling() {
    stopPolling();
    
    pollingTimer = setInterval(async () => {
        try {
            const result = await apiCall(`/orders/${currentUser.tableName}`);
            allOrders = result.data || [];
            updateStatusCounts();
            
            // Refresh current view if in orders list
            if (!document.getElementById('ordersView').classList.contains('hidden')) {
                displayOrders(currentStatus);
            }
        } catch (error) {
            console.error('Polling error:', error);
        }
    }, CONFIG.pollingInterval);
}

function stopPolling() {
    if (pollingTimer) {
        clearInterval(pollingTimer);
        pollingTimer = null;
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
    let filteredOrders = allOrders.filter(o => o.Status === status);

    // Für Abgelehnt und Erledigt nach Datum + Uhrzeit absteigend sortieren
    if (status === 'Abgelehnt' || status === 'Erledigt') {
        filteredOrders.sort((a, b) => {
            const dateA = new Date(`${a.Datum}T${a.Uhrzeit}`);
            const dateB = new Date(`${b.Datum}T${b.Uhrzeit}`);

            return dateB - dateA; // descending
        });
    }

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
    
    const services = parseServices(order.Dienstleistungen);
    const servicesHtml = services.map(s => `
        <div class="service-item">${escapeHtml(s.name + ' × ' + s.quantity)}</div>
    `).join('');
    console.log("Kunde: ", order.Kunde);

    let actionsHtml = '';
    if (status === 'Offen') {
        actionsHtml = `
            <div class="order-actions">
                <button class="btn btn-success edit-btn" data-order-id="${order.id}">Bearbeiten</button>
                <button class="btn btn-danger reject-btn" data-order-id="${order.id}">Ablehnen</button>
            </div>
        `;
    }

    card.innerHTML = `
        <div class="order-header">
            <div class="order-id">Auftrag #${order.id}</div>
            <div class="order-date">${formatDate(order.Auftragseingang, 'YYYY-DD-MM')}</div>
        </div>
        <div class="order-details">
            <div class="detail-item">
                <div class="detail-label">Kunde</div>
                <div class="detail-value">${escapeHtml(order.Kunde?.Name || 'N/A')}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Adresse</div>
                <div class="detail-value">${escapeHtml(order.Kunde?.Strasse + ' ' + order.Kunde?.["Hausnr."] + ', ' + order.Kunde?.PLZ + ' ' + order.Kunde?.Stadt || 'N/A')}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Telefon</div>
                <div class="detail-value">${escapeHtml(order.Kunde?.Telefonnummer || 'N/A')}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Email-Adresse</div>
                <div class="detail-value">${escapeHtml(order.Kunde?.["E-Mail-Adresse"] || 'N/A')}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Termin</div>
                <div class="detail-value">${escapeHtml(formatDate(order.Datum, 'YYYY-MM-DD') + ' um ' + formatTime(order.Uhrzeit) + ' (Dauer: ' + order.Geschaetzte_Gesamtdauer + ')' || 'N/A')}</div>
            </div>
        </div>
        <div class="order-services">
            <div class="detail-label" style="margin-bottom: 0.5rem;">Gebuchte Dienstleistungen</div>
            ${servicesHtml}
        </div>
        ${actionsHtml}
    `;

    // Add event listeners for action buttons
    if (status === 'Offen') {
        setTimeout(() => {
            const rejectBtn = card.querySelector('.reject-btn');
            const editBtn = card.querySelector('.edit-btn');
            
            if (rejectBtn) {
                rejectBtn.addEventListener('click', () => rejectOrder(order.id));
            }
            if (editBtn) {
                editBtn.addEventListener('click', () => openCompletionModal(order.id));
            }
        }, 0);
    }

    return card;
}

function backToStatus() {
    document.getElementById('ordersView').classList.add('hidden');
    document.getElementById('statusView').classList.remove('hidden');
}

function backToMaster() {
    currentUser.tableName = null;
    currentUser.selectedContractorName = null;
    stopPolling();
    showMasterView();
}

// ============================================================================
// ORDER ACTIONS
// ============================================================================
async function rejectOrder(orderId) {
    const confirmed = await customConfirm('Möchten Sie diesen Auftrag wirklich ablehnen? Es wird sofort eine E-Mail an den Kunden gesendet und kann nicht wieder rückgänig gemacht werden.', 'Auftrag ablehnen', 'info');
    if (!confirmed) {
        return;
    }

    try {
        await apiCall(`/orders/${currentUser.tableName}/${orderId}/reject`, {
            method: 'POST',
            body: JSON.stringify({
                contractorName: currentUser.name
            })
        });

        await customAlert('Der Auftrag wurde erfolgreich abgelehnt und der Kunde wurde benachrichtigt.', 'Auftrag erfolgreich abgelehnt', 'success');

        // Sofort neu laden
        await loadOrders();
        displayOrders(currentStatus);

    } catch (error) {
        console.error('Reject order error:', error);
        await customAlert('Fehler beim Ablehnen des Auftrags', 'Fehler', 'error');
    }
}

async function openCompletionModal(orderId) {
    currentOrder = allOrders.find(o => o.id === orderId);
    
    if (!currentOrder) {
        await customAlert('Auftrag nicht gefunden!', 'Fehler', 'error');
        return;
    }

    const services = parseServices(currentOrder.Dienstleistungen);
    const servicesHtml = services.map(s => `
        <div class="service-item">${escapeHtml(s.name + ' × ' + s.quantity)}</div>
    `).join('');

    document.getElementById('modalServices').innerHTML = servicesHtml;
    document.getElementById('confirmServices').checked = false;
    document.getElementById('completionModal').classList.add('active');

    setTimeout(() => {
        setupSignaturePad();
        clearSignature();
    }, 100);
}

function closeModal() {
    document.getElementById('completionModal').classList.remove('active');
    currentOrder = null;
}

async function completeOrder() {
    if (!document.getElementById('confirmServices').checked) {
        await customAlert('Bitte bestätigen Sie, dass alle Dienstleistungen durchgeführt wurden', 'Hinweis', 'warning');
        return;
    }

    if (!signaturePad.hasSignature) {
        await customAlert('Bitte lassen Sie den Kunden unterschreiben', 'Hinweis', 'warning');
        return;
    }

    try {
        const signatureData = signaturePad.canvas.toDataURL();

        await apiCall(`/orders/${currentUser.tableName}/${currentOrder.id}/complete`, {
            method: 'POST',
            body: JSON.stringify({
                signature: signatureData
            })
        });

        closeModal();

        await customAlert('Der Auftrag wurde erfolgreich abgeschlossen und die Unterschrift wurde gespeichert.', 'Auftrag erfolgreich abgeschlossen', 'success');
        
        // Sofort neu laden
        await loadOrders();
        displayOrders(currentStatus);

    } catch (error) {
        console.error('Complete order error:', error);
        await customAlert('Fehler beim Abschließen des Auftrags', 'Fehler', 'error');
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
function formatDate(dateString, inputFormat) {
    console.log("Formatieren von Datum: ", dateString); 
    if (!dateString) return 'N/A';

    try {
        let day, month, year;

        // Datum + Zeit trennen
        const [datePart, timePart] = dateString.split(/[T\s]/);

        const parts = datePart.split(/[-./]/);

        if (inputFormat === 'YYYY-MM-DD') {
            [year, month, day] = parts;
        } else if (inputFormat === 'YYYY-DD-MM') {
            [year, day, month] = parts;
        } else {
            return dateString;
        }

        console.log(`Parsed date - Year: ${year}, Month: ${month}, Day: ${day}`);

        const d = parseInt(day, 10);
        const m = parseInt(month, 10);
        const y = parseInt(year, 10);

        if (!d || !m || !y || d < 1 || d > 31 || m < 1 || m > 12 || y < 1900) {
            return 'N/A';
        }

        const paddedDay = String(d).padStart(2, '0');
        const paddedMonth = String(m).padStart(2, '0');

        let result = `${paddedDay}.${paddedMonth}.${y}`;

        // Zeit verarbeiten (falls vorhanden)
        if (timePart) {
            const formattedTime = formatTime(timePart);
            if (formattedTime) {
                result += ` ${formattedTime}`;
            }
        }

        return result;

    } catch (error) {
        console.error('Date formatting error:', error);
        return 'N/A';
    }
}


// Helper: HH:MM:SS → HH:MM
function formatTime(timeString) {
    if (!timeString) return null;

    try {
        const [h, m] = timeString.split(':');

        if (h === undefined || m === undefined) return null;

        const hh = String(parseInt(h, 10)).padStart(2, '0');
        const mm = String(parseInt(m, 10)).padStart(2, '0');

        return `${hh}:${mm}`;
    } catch {
        return null;
    }
}

function parseServices(services) {
    console.log("Parsing services: ", services);
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

})(); // End of IIFE wrapper