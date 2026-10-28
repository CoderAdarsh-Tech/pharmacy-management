const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const money = n => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(Number(n || 0));
const dateText = value => value ? new Date(value.length === 10 ? `${value}T00:00:00` : value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const state = { user: null, medicines: [], customers: [], suppliers: [], sales: [], cart: [], chart: null, editing: null, modalType: null };
let toastTimer;

function toast(message, error = false) {
  const el = $("#toast"); el.textContent = message; el.className = `toast show${error ? " error" : ""}`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.className = "toast", 3000);
}
async function api(url, options = {}) {
  const config = { ...options, headers: { ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...(options.headers || {}) } };
  if (config.body && !(config.body instanceof FormData) && typeof config.body !== "string") config.body = JSON.stringify(config.body);
  const response = await fetch(url, config);
  const data = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && url !== "/api/login") showLogin();
    throw new Error(data?.error || `Request failed (${response.status})`);
  }
  return data;
}
function showLogin() { $("#app").classList.add("hidden"); $("#login-screen").classList.remove("hidden"); }
function showApp(user) {
  state.user = user;
  $("#login-screen").classList.add("hidden"); $("#app").classList.remove("hidden");
  $("#user-name").textContent = user.name; $("#welcome-name").textContent = user.name.split(" ")[0];
  $("#today-label").textContent = new Date().toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
  loadAll().catch(e => toast(e.message, true));
}
function showPage(name) {
  $$(".page").forEach(p => p.classList.toggle("active", p.id === `page-${name}`));
  $$(".nav-item[data-page]").forEach(b => b.classList.toggle("active", b.dataset.page === name));
  $("#breadcrumb-page").textContent = ({ dashboard:"Dashboard", inventory:"Medicine inventory", billing:"Billing & invoices", customers:"Customers", suppliers:"Suppliers", prescriptions:"Prescriptions", reports:"Sales reports", about:"Project credits" })[name] || "Dashboard";
  $("#sidebar").classList.remove("open");
  if (name === "billing") renderBillingOptions();
  if (name === "reports") loadSales();
}
async function loadAll() {
  const [dashboard, medicines, customers, suppliers] = await Promise.all([
    api("/api/dashboard"), api("/api/medicines"), api("/api/customers"), api("/api/suppliers")
  ]);
  state.medicines = medicines; state.customers = customers; state.suppliers = suppliers;
  renderDashboard(dashboard); renderInventory(); renderCustomers(); renderSuppliers(); renderBillingOptions();
  await loadSales(); await loadPrescriptions();
}
function renderDashboard(data) {
  $("#metric-medicines").textContent = data.totalMedicines;
  $("#metric-today").textContent = money(data.salesToday);
  $("#metric-low").textContent = data.lowStock;
  $("#metric-expiring").textContent = data.expiring;
  $("#nav-stock-count").textContent = data.lowStock;
  $("#alert-count").textContent = data.alerts.length;
  $("#alerts-list").innerHTML = data.alerts.length ? data.alerts.map(a => `<div class="alert-item"><div class="alert-symbol ${a.alert === "Expiring soon" ? "expiry" : ""}">${a.alert === "Low stock" ? "!" : "◷"}</div><div class="alert-copy"><strong>${escapeHTML(a.name)}</strong><span>${a.alert === "Low stock" ? `${a.quantity} units remaining` : `Expires ${dateText(a.expiry_date)}`}</span></div><span class="alert-pill ${a.alert === "Expiring soon" ? "expiry" : ""}">${a.alert}</span></div>`).join("") : `<div class="empty-state"><strong>All clear!</strong><p>No stock alerts right now.</p></div>`;
  $("#recent-sales-body").innerHTML = data.recentSales.length ? data.recentSales.map(s => `<tr><td><strong>${escapeHTML(s.invoice_no)}</strong></td><td>${escapeHTML(s.customer_name)}</td><td>${dateText(s.created_at)}</td><td class="align-right"><strong>${money(s.total)}</strong></td><td><span class="status-badge">Completed</span></td></tr>`).join("") : `<tr><td colspan="5"><div class="empty-state"><strong>No transactions yet</strong><p>Create a bill to see recent sales.</p></div></td></tr>`;
  const chartData = data.chart || [];
  $("#chart-empty").classList.toggle("hidden", chartData.length > 0);
  const canvas = $("#sales-chart");
  if (state.chart) state.chart.destroy();
  if (window.Chart && canvas) state.chart = new Chart(canvas, {
    type: "line",
    data: { labels: chartData.map(x => dateText(x.day)), datasets: [{ label: "Sales", data: chartData.map(x => x.total), borderColor: "#17845a", backgroundColor: "rgba(23,132,90,.12)", fill: true, tension: .35, pointRadius: 4, pointBackgroundColor: "#17845a" }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { color: getComputedStyle(document.body).getPropertyValue("--line") }, ticks: { callback: v => "₹" + v } }, x: { grid: { display: false } } } }
  });
}
function medicineStatus(m) {
  const today = new Date().toISOString().slice(0,10);
  if (m.quantity <= 0) return "out";
  if (m.quantity <= 10) return "low";
  if (m.expiry_date && m.expiry_date < today) return "out";
  return "";
}
function renderInventory() {
  const q = ($("#medicine-search")?.value || "").toLowerCase();
  const category = $("#category-filter")?.value || "";
  const rows = state.medicines.filter(m => (!category || m.category === category) && `${m.name} ${m.category} ${m.batch_no} ${m.supplier_name || ""}`.toLowerCase().includes(q));
  $("#inventory-count").textContent = `${rows.length} item${rows.length === 1 ? "" : "s"}`;
  $("#inventory-empty").classList.toggle("hidden", rows.length > 0);
  $("#inventory-body").innerHTML = rows.map(m => `<tr><td><div class="medicine-cell"><span class="medicine-icon">✚</span><div class="medicine-meta"><strong>${escapeHTML(m.name)}</strong><span>ID: MED-${String(m.id).padStart(4,"0")}</span></div></div></td><td>${escapeHTML(m.batch_no || "—")}</td><td>${escapeHTML(m.category)}</td><td>${dateText(m.expiry_date)}</td><td><strong>${money(m.price)}</strong></td><td><span class="stock-badge ${medicineStatus(m)}">${m.quantity} units</span></td><td>${escapeHTML(m.supplier_name || "—")}</td><td><div class="action-group"><button class="small-action" data-edit-medicine="${m.id}">Edit</button><button class="small-action delete" data-delete-medicine="${m.id}">Delete</button></div></td></tr>`).join("");
  const categories = [...new Set(state.medicines.map(m => m.category).filter(Boolean))].sort();
  const current = $("#category-filter").value;
  $("#category-filter").innerHTML = `<option value="">All categories</option>` + categories.map(c => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join("");
  $("#category-filter").value = categories.includes(current) ? current : "";
  renderBillingOptions();
}
function renderCustomers() {
  const q = ($("#customer-search")?.value || "").toLowerCase();
  const rows = state.customers.filter(c => `${c.name} ${c.phone} ${c.email}`.toLowerCase().includes(q));
  $("#customer-count").textContent = `${rows.length} customer${rows.length === 1 ? "" : "s"}`;
  $("#customers-empty").classList.toggle("hidden", rows.length > 0);
  $("#customers-body").innerHTML = rows.map(c => `<tr><td><div class="medicine-cell"><span class="user-avatar">${escapeHTML(c.name.split(/\s+/).map(x=>x[0]).slice(0,2).join("").toUpperCase())}</span><div class="medicine-meta"><strong>${escapeHTML(c.name)}</strong><span>${escapeHTML(c.address || "No address added")}</span></div></div></td><td>${escapeHTML(c.phone || "—")}</td><td>${escapeHTML(c.email || "—")}</td><td>${c.order_count || 0}</td><td><strong>${money(c.spent)}</strong></td><td><div class="action-group"><button class="small-action" data-edit-customer="${c.id}">Edit</button><button class="small-action delete" data-delete-customer="${c.id}">Delete</button></div></td></tr>`).join("");
}
function renderSuppliers() {
  const q = ($("#supplier-search")?.value || "").toLowerCase();
  const rows = state.suppliers.filter(s => `${s.name} ${s.phone} ${s.email} ${s.address}`.toLowerCase().includes(q));
  $("#supplier-count").textContent = `${rows.length} supplier${rows.length === 1 ? "" : "s"}`;
  $("#suppliers-empty").classList.toggle("hidden", rows.length > 0);
  $("#suppliers-body").innerHTML = rows.map(s => `<tr><td><div class="medicine-cell"><span class="medicine-icon">♧</span><div class="medicine-meta"><strong>${escapeHTML(s.name)}</strong><span>SUP-${String(s.id).padStart(4,"0")}</span></div></div></td><td>${escapeHTML(s.phone || "—")}</td><td>${escapeHTML(s.email || "—")}</td><td>${escapeHTML(s.address || "—")}</td><td>${s.medicine_count || 0}</td><td><div class="action-group"><button class="small-action" data-edit-supplier="${s.id}">Edit</button><button class="small-action delete" data-delete-supplier="${s.id}">Delete</button></div></td></tr>`).join("");
}
function renderBillingOptions() {
  const customer = $("#bill-customer")?.value || "";
  const medicine = $("#bill-medicine")?.value || "";
  if ($("#bill-customer")) $("#bill-customer").innerHTML = `<option value="">Walk-in customer</option>` + state.customers.map(c => `<option value="${c.id}">${escapeHTML(c.name)} · ${escapeHTML(c.phone || "no phone")}</option>`).join("");
  if ($("#bill-customer")) $("#bill-customer").value = customer;
  if ($("#bill-medicine")) $("#bill-medicine").innerHTML = `<option value="">Select medicine</option>` + state.medicines.filter(m => m.quantity > 0).map(m => `<option value="${m.id}">${escapeHTML(m.name)} · ${money(m.price)} · ${m.quantity} in stock</option>`).join("");
  if ($("#bill-medicine")) $("#bill-medicine").value = medicine;
  renderCart();
}
function cartTotals() {
  const subtotal = state.cart.reduce((s, x) => s + x.price * x.quantity, 0);
  const discountPct = Math.min(100, Math.max(0, Number($("#bill-discount")?.value || 0)));
  const gstPct = Math.min(100, Math.max(0, Number($("#bill-gst")?.value || 0)));
  const discount = subtotal * discountPct / 100;
  const gst = (subtotal - discount) * gstPct / 100;
  return { subtotal, discount, gst, total: subtotal - discount + gst, discountPct, gstPct };
}
function renderCart() {
  const body = $("#cart-body"); if (!body) return;
  body.innerHTML = state.cart.map((x,i) => `<tr><td><strong>${escapeHTML(x.name)}</strong><br><small>${escapeHTML(x.category)}</small></td><td>${money(x.price)}</td><td>${x.quantity}</td><td><strong>${money(x.price*x.quantity)}</strong></td><td><button class="remove-cart" data-remove-cart="${i}" aria-label="Remove item">×</button></td></tr>`).join("");
  $("#empty-cart").classList.toggle("hidden", state.cart.length > 0);
  const t = cartTotals();
  $("#summary-items").textContent = state.cart.reduce((n,x)=>n+x.quantity,0);
  $("#summary-subtotal").textContent = money(t.subtotal);
  $("#summary-discount").textContent = `−${money(t.discount)}`;
  $("#summary-gst").textContent = money(t.gst);
  $("#bill-grand-total").textContent = money(t.total);
}
async function loadSales() {
  state.sales = await api("/api/sales");
  const q = ($("#sales-search")?.value || "").toLowerCase();
  const rows = state.sales.filter(s => `${s.invoice_no} ${s.customer_name}`.toLowerCase().includes(q));
  $("#report-total-sales").textContent = money(state.sales.reduce((sum,s)=>sum+s.total,0));
  $("#report-invoice-count").textContent = state.sales.length;
  $("#sales-empty").classList.toggle("hidden", rows.length > 0);
  $("#sales-body").innerHTML = rows.map(s => `<tr><td><strong>${escapeHTML(s.invoice_no)}</strong></td><td>${escapeHTML(s.customer_name)}</td><td>${dateText(s.created_at)}</td><td>${money(s.subtotal)}</td><td>${money(s.discount)}</td><td>${money(s.gst)}</td><td class="align-right"><strong>${money(s.total)}</strong></td><td><button class="small-action" data-view-invoice="${s.id}">View</button></td></tr>`).join("");
}
async function loadPrescriptions() {
  const rows = await api("/api/prescriptions");
  $("#prescription-list").innerHTML = rows.length ? rows.map(p => `<div class="record-item"><img class="record-thumb" src="/uploads/${encodeURIComponent(p.filename)}" alt=""><div><strong>${escapeHTML(p.patient_name)}</strong><span>${escapeHTML(p.original_name)} · ${dateText(p.uploaded_at)}</span></div><a href="/uploads/${encodeURIComponent(p.filename)}" target="_blank" rel="noopener">Open</a></div>`).join("") : `<div class="empty-state"><strong>No uploads yet</strong><p>Uploaded demo records will appear here.</p></div>`;
}
function field(label, name, type = "text", value = "", extra = "") {
  return `<label class="${extra}">${label}<input name="${name}" type="${type}" value="${escapeHTML(value)}" ${type === "number" ? 'min="0" step="any"' : ""} ${name === "name" ? "required" : ""}></label>`;
}
function openEntityModal(type, item = null) {
  state.modalType = type; state.editing = item;
  const isEdit = Boolean(item);
  const config = {
    medicine: { title: isEdit ? "Edit medicine" : "Add medicine", eyebrow: "INVENTORY", fields: `
      ${field("Medicine name","name","text",item?.name || "")}
      <label>Category<input name="category" value="${escapeHTML(item?.category || "General")}" required></label>
      ${field("Batch number","batch_no","text",item?.batch_no || "")}
      ${field("Unit price (₹)","price","number",item?.price ?? "","")}
      ${field("Quantity in stock","quantity","number",item?.quantity ?? 0)}
      ${field("Expiry date","expiry_date","date",item?.expiry_date || "")}
      <label class="full">Supplier<select name="supplier_id"><option value="">No supplier selected</option>${state.suppliers.map(s=>`<option value="${s.id}" ${String(item?.supplier_id||"")===String(s.id)?"selected":""}>${escapeHTML(s.name)}</option>`).join("")}</select></label>` },
    customer: { title: isEdit ? "Edit customer" : "Add customer", eyebrow: "CUSTOMERS", fields: `
      ${field("Full name","name","text",item?.name || "")}
      ${field("Phone","phone","tel",item?.phone || "")}
      ${field("Email","email","email",item?.email || "")}
      <label class="full">Address<textarea name="address">${escapeHTML(item?.address || "")}</textarea></label>` },
    supplier: { title: isEdit ? "Edit supplier" : "Add supplier", eyebrow: "SUPPLIERS", fields: `
      ${field("Supplier name","name","text",item?.name || "")}
      ${field("Phone","phone","tel",item?.phone || "")}
      ${field("Email","email","email",item?.email || "")}
      <label class="full">Address<textarea name="address">${escapeHTML(item?.address || "")}</textarea></label>` }
  }[type];
  $("#modal-title").textContent = config.title; $("#modal-eyebrow").textContent = config.eyebrow; $("#modal-fields").innerHTML = config.fields;
  $("#entity-dialog").showModal();
}
async function saveEntity(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData($("#entity-form")));
  const type = state.modalType, item = state.editing;
  try {
    if (type === "medicine") {
      data.price = Number(data.price); data.quantity = Number(data.quantity); data.supplier_id = data.supplier_id ? Number(data.supplier_id) : null;
      await api(item ? `/api/medicines/${item.id}` : "/api/medicines", { method: item ? "PUT" : "POST", body: data });
    } else if (type === "customer") {
      await api(item ? `/api/customers/${item.id}` : "/api/customers", { method: item ? "PUT" : "POST", body: data });
    } else if (type === "supplier") {
      await api(item ? `/api/suppliers/${item.id}` : "/api/suppliers", { method: item ? "PUT" : "POST", body: data });
    }
    $("#entity-dialog").close(); toast(`${type[0].toUpperCase()+type.slice(1)} ${item ? "updated" : "added"} successfully.`);
    await loadAll();
  } catch (e) { toast(e.message, true); }
}
async function deleteRecord(type, id) {
  const item = ({medicine:state.medicines, customer:state.customers, supplier:state.suppliers})[type].find(x => x.id === id);
  if (!item || !confirm(`Delete "${item.name}"? This cannot be undone.`)) return;
  try {
    await api(`/${({medicine:"api/medicines",customer:"api/customers",supplier:"api/suppliers"})[type]}/${id}`, { method: "DELETE" });
    toast(`${type[0].toUpperCase()+type.slice(1)} deleted.`); await loadAll();
  } catch (e) { toast(e.message, true); }
}
function invoiceMarkup(sale) {
  return `<div class="invoice-paper"><div style="display:flex;justify-content:space-between;gap:15px"><div><h2>MediCare Pharmacy</h2><p>Pharmacy Management System · School Project Demo</p></div><div style="text-align:right"><strong>INVOICE</strong><p>${escapeHTML(sale.invoice_no)}</p></div></div><hr style="border:0;border-top:1px solid #dfe8e1"><p><strong>Customer:</strong> ${escapeHTML(sale.customer_name)}<br><strong>Date:</strong> ${dateText(sale.created_at)}</p><table><thead><tr><th>Medicine</th><th>Qty</th><th>Unit price</th><th class="align-right">Amount</th></tr></thead><tbody>${(sale.items||[]).map(i=>`<tr><td>${escapeHTML(i.medicine_name)}</td><td>${i.quantity}</td><td>${money(i.unit_price)}</td><td class="align-right">${money(i.line_total)}</td></tr>`).join("")}</tbody></table><div class="invoice-total">Subtotal: ${money(sale.subtotal)}<br>Discount: −${money(sale.discount)}<br>GST: ${money(sale.gst)}<br><strong>Total: ${money(sale.total)}</strong></div><hr style="border:0;border-top:1px solid #dfe8e1"><p style="text-align:center">Thank you for choosing MediCare. This is a project demo invoice.</p></div>`;
}
function openInvoice(sale) { $("#invoice-print-area").innerHTML = invoiceMarkup(sale); $("#invoice-dialog").showModal(); }
async function completeSale() {
  if (!state.cart.length) return toast("Add at least one medicine to the bill.", true);
  const t = cartTotals();
  try {
    const sale = await api("/api/sales", { method:"POST", body: {
      customer_id: $("#bill-customer").value || null,
      customer_name: $("#walkin-name").value.trim(),
      discount: t.discountPct, gst: t.gstPct,
      items: state.cart.map(x => ({ medicine_id:x.id, quantity:x.quantity }))
    }});
    state.cart = []; $("#walkin-name").value = ""; $("#bill-discount").value = 0; $("#bill-gst").value = 5;
    renderCart(); toast("Sale completed and stock updated."); await loadAll(); openInvoice(sale);
  } catch (e) { toast(e.message, true); }
}
function exportCSV() {
  const headers = ["Invoice","Customer","Date","Subtotal","Discount","GST","Total"];
  const rows = state.sales.map(s => [s.invoice_no,s.customer_name,s.created_at,s.subtotal,s.discount,s.gst,s.total]);
  const csv = [headers,...rows].map(row => row.map(v => `"${String(v ?? "").replace(/"/g,'""')}"`).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], {type:"text/csv;charset=utf-8;"}));
  const a = document.createElement("a"); a.href=url; a.download="pharmacy-sales.csv"; a.click(); URL.revokeObjectURL(url);
}

$("#login-form").addEventListener("submit", async e => {
  e.preventDefault(); const data = Object.fromEntries(new FormData(e.currentTarget));
  try { const result = await api("/api/login", { method:"POST", body:data }); showApp(result.user); }
  catch (err) { toast(err.message, true); }
});
$("#logout-btn").addEventListener("click", async () => { await api("/api/logout", {method:"POST"}); state.user=null; showLogin(); });
$$(".nav-item[data-page]").forEach(b => b.addEventListener("click", () => showPage(b.dataset.page)));
$$("[data-goto]").forEach(b => b.addEventListener("click", () => showPage(b.dataset.goto)));
$("#mobile-menu").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
$("#theme-toggle").addEventListener("click", () => { document.body.classList.toggle("dark"); $("#theme-toggle").textContent = document.body.classList.contains("dark") ? "☀" : "☾"; if (state.chart) state.chart.update(); });
$("#add-medicine-btn").addEventListener("click", () => openEntityModal("medicine"));
$("#add-customer-btn").addEventListener("click", () => openEntityModal("customer"));
$("#add-supplier-btn").addEventListener("click", () => openEntityModal("supplier"));
$("#entity-form").addEventListener("submit", saveEntity);
$("#modal-close").addEventListener("click", () => $("#entity-dialog").close());
$("#modal-cancel").addEventListener("click", () => $("#entity-dialog").close());
$("#medicine-search").addEventListener("input", renderInventory);
$("#category-filter").addEventListener("change", renderInventory);
$("#customer-search").addEventListener("input", renderCustomers);
$("#supplier-search").addEventListener("input", renderSuppliers);
$("#sales-search").addEventListener("input", () => loadSales().catch(e=>toast(e.message,true)));
$("#bill-discount").addEventListener("input", renderCart);
$("#bill-gst").addEventListener("input", renderCart);
$("#add-to-cart").addEventListener("click", () => {
  const id = Number($("#bill-medicine").value), qty = Number($("#bill-quantity").value);
  const m = state.medicines.find(x => x.id === id);
  if (!m) return toast("Choose a medicine first.", true);
  if (!Number.isInteger(qty) || qty < 1) return toast("Quantity must be a whole number above zero.", true);
  const existing = state.cart.find(x=>x.id===id);
  if ((existing?.quantity || 0) + qty > m.quantity) return toast(`Only ${m.quantity} units of ${m.name} are in stock.`, true);
  if (existing) existing.quantity += qty; else state.cart.push({id:m.id,name:m.name,category:m.category,price:m.price,quantity:qty});
  $("#bill-quantity").value=1; $("#bill-medicine").value=""; renderCart();
});
$("#cart-body").addEventListener("click", e => { const b=e.target.closest("[data-remove-cart]"); if(b){state.cart.splice(Number(b.dataset.removeCart),1);renderCart();} });
$("#complete-sale").addEventListener("click", completeSale);
$("#invoice-close").addEventListener("click", () => $("#invoice-dialog").close());
$("#invoice-print").addEventListener("click", () => window.print());
$("#export-sales-btn").addEventListener("click", exportCSV);
$("#prescription-form").addEventListener("submit", async e => {
  e.preventDefault(); const form = new FormData(e.currentTarget);
  try { await api("/api/prescriptions", {method:"POST",body:form}); e.currentTarget.reset(); toast("Prescription image uploaded."); await loadPrescriptions(); }
  catch(err) { toast(err.message,true); }
});
document.addEventListener("click", async e => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.editMedicine) openEntityModal("medicine", state.medicines.find(x=>x.id===Number(b.dataset.editMedicine)));
  if (b.dataset.deleteMedicine) deleteRecord("medicine",Number(b.dataset.deleteMedicine));
  if (b.dataset.editCustomer) openEntityModal("customer", state.customers.find(x=>x.id===Number(b.dataset.editCustomer)));
  if (b.dataset.deleteCustomer) deleteRecord("customer",Number(b.dataset.deleteCustomer));
  if (b.dataset.editSupplier) openEntityModal("supplier", state.suppliers.find(x=>x.id===Number(b.dataset.editSupplier)));
  if (b.dataset.deleteSupplier) deleteRecord("supplier",Number(b.dataset.deleteSupplier));
  if (b.dataset.viewInvoice) { try { openInvoice(await api(`/api/sales/${b.dataset.viewInvoice}`)); } catch(err) { toast(err.message,true); } }
});
(async function init() {
  try {
    const session = await api("/api/session");
    if (session.user) showApp(session.user); else showLogin();
  } catch (_) { showLogin(); }
})();
