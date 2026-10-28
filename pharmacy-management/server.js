const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const db = require("./database");

const app = express();
const PORT = process.env.PORT || 3000;
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || "replace-this-secret-for-real-deployment",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: false, maxAge: 8 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(uploadDir));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().slice(0, 10);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 9)}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error("Upload a JPG, PNG, WEBP or GIF image only."));
  }
});

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Please log in first." });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.status(401).json({ error: "Admin login required." });
  }
  next();
}
function cleanText(value, max = 160) {
  return String(value ?? "").trim().slice(0, max);
}
function num(value, min = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n >= min ? n : null;
}
function apiError(res, error, status = 400) {
  console.error(error);
  return res.status(status).json({ error: error.message || "Something went wrong." });
}

app.get("/api/session", (req, res) => {
  res.json({ user: req.session.user || null });
});

app.post("/api/login", (req, res) => {
  const username = cleanText(req.body.username, 80);
  const password = String(req.body.password || "");
  const user = db.prepare("SELECT id, name, username, password_hash, role FROM users WHERE username = ?").get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Incorrect username or password." });
  }
  req.session.user = { id: user.id, name: user.name, username: user.username, role: user.role };
  res.json({ user: req.session.user });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/dashboard", requireAuth, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const totalMedicines = db.prepare("SELECT COUNT(*) AS n FROM medicines").get().n;
  const lowStock = db.prepare("SELECT COUNT(*) AS n FROM medicines WHERE quantity <= 10").get().n;
  const expiring = db.prepare("SELECT COUNT(*) AS n FROM medicines WHERE expiry_date <> '' AND expiry_date >= ? AND expiry_date <= ?").get(today, soon).n;
  const salesToday = db.prepare("SELECT COALESCE(SUM(total), 0) AS total FROM sales WHERE date(created_at) = date('now','localtime')").get().total;
  const totalSales = db.prepare("SELECT COALESCE(SUM(total), 0) AS total FROM sales").get().total;
  const recentSales = db.prepare("SELECT id, invoice_no, customer_name, total, created_at FROM sales ORDER BY id DESC LIMIT 6").all();
  const chart = db.prepare(`SELECT date(created_at) AS day, ROUND(SUM(total),2) AS total
    FROM sales WHERE created_at >= datetime('now','-6 days') GROUP BY date(created_at) ORDER BY day`).all();
  const alerts = db.prepare(`SELECT id, name, quantity, expiry_date,
    CASE WHEN quantity <= 10 THEN 'Low stock' ELSE 'Expiring soon' END AS alert
    FROM medicines WHERE quantity <= 10 OR (expiry_date <> '' AND expiry_date >= ? AND expiry_date <= ?)
    ORDER BY quantity ASC LIMIT 8`).all(today, soon);
  res.json({ totalMedicines, lowStock, expiring, salesToday, totalSales, recentSales, chart, alerts });
});

app.get("/api/medicines", requireAuth, (req, res) => {
  const q = `%${cleanText(req.query.q, 100)}%`;
  const category = cleanText(req.query.category, 80);
  let sql = `SELECT m.*, s.name AS supplier_name FROM medicines m LEFT JOIN suppliers s ON s.id=m.supplier_id WHERE (m.name LIKE ? OR m.category LIKE ? OR m.batch_no LIKE ?)`;
  const params = [q, q, q];
  if (category) { sql += " AND m.category = ?"; params.push(category); }
  sql += " ORDER BY m.name COLLATE NOCASE";
  res.json(db.prepare(sql).all(...params));
});

app.post("/api/medicines", requireAdmin, (req, res) => {
  const name = cleanText(req.body.name);
  const category = cleanText(req.body.category) || "General";
  const price = num(req.body.price);
  const quantity = num(req.body.quantity);
  if (!name || price === null || quantity === null) return res.status(400).json({ error: "Name, valid price and quantity are required." });
  const info = db.prepare(`INSERT INTO medicines (name, category, batch_no, price, quantity, expiry_date, supplier_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(name, category, cleanText(req.body.batch_no, 80), price, Math.floor(quantity), cleanText(req.body.expiry_date, 20), num(req.body.supplier_id, 1));
  res.status(201).json(db.prepare("SELECT * FROM medicines WHERE id = ?").get(info.lastInsertRowid));
});

app.put("/api/medicines/:id", requireAdmin, (req, res) => {
  const id = num(req.params.id, 1);
  const name = cleanText(req.body.name);
  const price = num(req.body.price);
  const quantity = num(req.body.quantity);
  if (!id || !name || price === null || quantity === null) return res.status(400).json({ error: "Please provide valid medicine details." });
  const result = db.prepare(`UPDATE medicines SET name=?, category=?, batch_no=?, price=?, quantity=?, expiry_date=?, supplier_id=? WHERE id=?`)
    .run(name, cleanText(req.body.category) || "General", cleanText(req.body.batch_no, 80), price, Math.floor(quantity), cleanText(req.body.expiry_date, 20), num(req.body.supplier_id, 1), id);
  if (!result.changes) return res.status(404).json({ error: "Medicine not found." });
  res.json(db.prepare("SELECT * FROM medicines WHERE id = ?").get(id));
});

app.delete("/api/medicines/:id", requireAdmin, (req, res) => {
  const result = db.prepare("DELETE FROM medicines WHERE id = ?").run(num(req.params.id, 1));
  if (!result.changes) return res.status(404).json({ error: "Medicine not found." });
  res.json({ ok: true });
});

app.get("/api/suppliers", requireAuth, (_req, res) => {
  res.json(db.prepare("SELECT s.*, COUNT(m.id) AS medicine_count FROM suppliers s LEFT JOIN medicines m ON m.supplier_id=s.id GROUP BY s.id ORDER BY s.name").all());
});
app.post("/api/suppliers", requireAdmin, (req, res) => {
  const name = cleanText(req.body.name);
  if (!name) return res.status(400).json({ error: "Supplier name is required." });
  const info = db.prepare("INSERT INTO suppliers (name, phone, email, address) VALUES (?, ?, ?, ?)")
    .run(name, cleanText(req.body.phone, 40), cleanText(req.body.email, 120), cleanText(req.body.address, 240));
  res.status(201).json(db.prepare("SELECT * FROM suppliers WHERE id=?").get(info.lastInsertRowid));
});
app.put("/api/suppliers/:id", requireAdmin, (req, res) => {
  const name = cleanText(req.body.name);
  if (!name) return res.status(400).json({ error: "Supplier name is required." });
  const result = db.prepare("UPDATE suppliers SET name=?, phone=?, email=?, address=? WHERE id=?")
    .run(name, cleanText(req.body.phone, 40), cleanText(req.body.email, 120), cleanText(req.body.address, 240), num(req.params.id, 1));
  if (!result.changes) return res.status(404).json({ error: "Supplier not found." });
  res.json({ ok: true });
});
app.delete("/api/suppliers/:id", requireAdmin, (req, res) => {
  const result = db.prepare("DELETE FROM suppliers WHERE id=?").run(num(req.params.id, 1));
  if (!result.changes) return res.status(404).json({ error: "Supplier not found." });
  res.json({ ok: true });
});

app.get("/api/customers", requireAuth, (_req, res) => {
  res.json(db.prepare(`SELECT c.*, COUNT(s.id) AS order_count, COALESCE(SUM(s.total),0) AS spent
    FROM customers c LEFT JOIN sales s ON s.customer_id=c.id GROUP BY c.id ORDER BY c.name`).all());
});
app.post("/api/customers", requireAdmin, (req, res) => {
  const name = cleanText(req.body.name);
  if (!name) return res.status(400).json({ error: "Customer name is required." });
  const info = db.prepare("INSERT INTO customers (name, phone, email, address) VALUES (?, ?, ?, ?)")
    .run(name, cleanText(req.body.phone, 40), cleanText(req.body.email, 120), cleanText(req.body.address, 240));
  res.status(201).json(db.prepare("SELECT * FROM customers WHERE id=?").get(info.lastInsertRowid));
});
app.put("/api/customers/:id", requireAdmin, (req, res) => {
  const name = cleanText(req.body.name);
  if (!name) return res.status(400).json({ error: "Customer name is required." });
  const result = db.prepare("UPDATE customers SET name=?, phone=?, email=?, address=? WHERE id=?")
    .run(name, cleanText(req.body.phone, 40), cleanText(req.body.email, 120), cleanText(req.body.address, 240), num(req.params.id, 1));
  if (!result.changes) return res.status(404).json({ error: "Customer not found." });
  res.json({ ok: true });
});
app.delete("/api/customers/:id", requireAdmin, (req, res) => {
  const result = db.prepare("DELETE FROM customers WHERE id=?").run(num(req.params.id, 1));
  if (!result.changes) return res.status(404).json({ error: "Customer not found." });
  res.json({ ok: true });
});

app.post("/api/sales", requireAdmin, (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  const discountPct = num(req.body.discount, 0);
  const gstPct = num(req.body.gst, 0);
  if (!items.length || discountPct === null || gstPct === null || discountPct > 100 || gstPct > 100) {
    return res.status(400).json({ error: "Add at least one item and use valid discount/GST percentages." });
  }
  const customerId = num(req.body.customer_id, 1);
  let customerName = "Walk-in Customer";
  if (customerId) {
    const customer = db.prepare("SELECT name FROM customers WHERE id=?").get(customerId);
    if (!customer) return res.status(400).json({ error: "Selected customer was not found." });
    customerName = customer.name;
  } else if (cleanText(req.body.customer_name)) customerName = cleanText(req.body.customer_name);

  const normalized = [];
  for (const item of items) {
    const medicineId = num(item.medicine_id, 1);
    const quantity = num(item.quantity, 1);
    if (!medicineId || !quantity || !Number.isInteger(quantity)) return res.status(400).json({ error: "Each item needs a medicine and whole-number quantity." });
    const medicine = db.prepare("SELECT * FROM medicines WHERE id=?").get(medicineId);
    if (!medicine) return res.status(400).json({ error: "A selected medicine no longer exists." });
    if (medicine.quantity < quantity) return res.status(400).json({ error: `Not enough stock for ${medicine.name}. Available: ${medicine.quantity}.` });
    normalized.push({ medicine, quantity });
  }
  const subtotal = normalized.reduce((sum, row) => sum + row.medicine.price * row.quantity, 0);
  const discount = subtotal * discountPct / 100;
  const afterDiscount = subtotal - discount;
  const gst = afterDiscount * gstPct / 100;
  const total = afterDiscount + gst;
  const invoiceNo = `PH-${Date.now().toString().slice(-8)}`;
  const transaction = db.transaction(() => {
    const sale = db.prepare(`INSERT INTO sales (invoice_no, customer_id, customer_name, subtotal, discount, gst, total)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(invoiceNo, customerId, customerName, subtotal, discount, gst, total);
    const itemInsert = db.prepare(`INSERT INTO sale_items (sale_id, medicine_id, medicine_name, quantity, unit_price, line_total)
      VALUES (?, ?, ?, ?, ?, ?)`);
    const stockUpdate = db.prepare("UPDATE medicines SET quantity=quantity-? WHERE id=?");
    normalized.forEach(row => {
      itemInsert.run(sale.lastInsertRowid, row.medicine.id, row.medicine.name, row.quantity, row.medicine.price, row.medicine.price * row.quantity);
      stockUpdate.run(row.quantity, row.medicine.id);
    });
    return sale.lastInsertRowid;
  });
  const saleId = transaction();
  res.status(201).json(getSale(saleId));
});

function getSale(id) {
  const sale = db.prepare("SELECT * FROM sales WHERE id=?").get(id);
  if (!sale) return null;
  sale.items = db.prepare("SELECT * FROM sale_items WHERE sale_id=?").all(id);
  return sale;
}
app.get("/api/sales", requireAuth, (_req, res) => {
  res.json(db.prepare("SELECT * FROM sales ORDER BY id DESC LIMIT 100").all());
});
app.get("/api/sales/:id", requireAuth, (req, res) => {
  const sale = getSale(num(req.params.id, 1));
  if (!sale) return res.status(404).json({ error: "Invoice not found." });
  res.json(sale);
});

app.post("/api/prescriptions", requireAdmin, upload.single("prescription"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose a prescription image first." });
  const patientName = cleanText(req.body.patient_name) || "Not specified";
  const info = db.prepare("INSERT INTO prescriptions (patient_name, filename, original_name) VALUES (?, ?, ?)")
    .run(patientName, req.file.filename, path.basename(req.file.originalname));
  res.status(201).json({ id: info.lastInsertRowid, patient_name: patientName, filename: req.file.filename, original_name: req.file.originalname, uploaded_at: new Date().toISOString() });
});
app.get("/api/prescriptions", requireAuth, (_req, res) => {
  res.json(db.prepare("SELECT * FROM prescriptions ORDER BY id DESC").all());
});

app.get("/api/categories", requireAuth, (_req, res) => {
  res.json(db.prepare("SELECT DISTINCT category FROM medicines ORDER BY category").all().map(x => x.category));
});

app.get("/api/contact", requireAuth, (_req, res) => res.json({ pharmacyName: "MediCare Pharmacy", hours: "Mon–Sat, 9:00 AM – 9:00 PM", email: "care@example.com", phone: "+91 98765 43210", address: "Your pharmacy address goes here" }));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(400).json({ error: err.message || "Request failed." });
});

app.listen(PORT, () => {
  console.log(`\nMediCare Pharmacy is running at http://localhost:${PORT}`);
  console.log("Demo admin login: username = admin | password = admin123\n");
});
