const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const path = require("path");

const db = new Database(path.join(__dirname, "pharmacy.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS medicines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'General',
  batch_no TEXT DEFAULT '',
  price REAL NOT NULL DEFAULT 0,
  quantity INTEGER NOT NULL DEFAULT 0,
  expiry_date TEXT DEFAULT '',
  supplier_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  address TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  address TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no TEXT NOT NULL UNIQUE,
  customer_id INTEGER,
  customer_name TEXT NOT NULL DEFAULT 'Walk-in Customer',
  subtotal REAL NOT NULL,
  discount REAL NOT NULL DEFAULT 0,
  gst REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL,
  medicine_id INTEGER,
  medicine_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  line_total REAL NOT NULL,
  FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
  FOREIGN KEY (medicine_id) REFERENCES medicines(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS prescriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_name TEXT NOT NULL,
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL,
  uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

const admin = db.prepare("SELECT id FROM users WHERE username = ?").get("admin");
if (!admin) {
  const hash = bcrypt.hashSync("admin123", 10);
  db.prepare("INSERT INTO users (name, username, password_hash, role) VALUES (?, ?, ?, ?)")
    .run("Pharmacy Administrator", "admin", hash, "admin");
}

// Seed a small set of demo records on first run.
if (db.prepare("SELECT COUNT(*) AS n FROM medicines").get().n === 0) {
  const insert = db.prepare(`INSERT INTO medicines
    (name, category, batch_no, price, quantity, expiry_date) VALUES (?, ?, ?, ?, ?, ?)`);
  const seeds = [
    ["Paracetamol 500mg", "Pain Relief", "PCM-2401", 18, 120, "2027-08-31"],
    ["Cetirizine 10mg", "Allergy", "CTZ-1102", 25, 8, "2027-02-28"],
    ["Vitamin C Tablets", "Vitamins", "VTC-0408", 90, 42, "2027-11-30"],
    ["ORS Sachet", "First Aid", "ORS-0901", 22, 6, "2027-01-31"],
    ["Antacid Tablets", "Digestive Health", "ANT-0712", 35, 30, "2028-03-31"],
    ["Cough Syrup 100ml", "Cold & Cough", "CS-0605", 75, 15, "2027-05-31"]
  ];
  const tx = db.transaction(rows => rows.forEach(row => insert.run(...row)));
  tx(seeds);
}

module.exports = db;
