# MediCare Pharmacy Management System

A school-project demo built with HTML, CSS, JavaScript, Node.js, Express and SQLite.

## Features
- Admin login with hashed password storage
- Dashboard metrics, sales chart and stock/expiry alerts
- Medicine inventory: add, edit, delete, search and category filter
- Billing: cart, discount, GST, stock validation and printable invoice
- Customer and supplier management
- Prescription image upload for demo purposes
- Sales history and CSV export
- Dark mode and responsive layout
- Project credits section

## Requirements
- Windows 10/11
- Node.js LTS (includes npm): https://nodejs.org/
- A modern browser

## Run on Windows
1. Extract the ZIP.
2. Open the extracted `pharmacy-management` folder.
3. Open a terminal in that folder (File Explorer address bar: type `cmd` and press Enter).
4. Run:
   ```bash
   npm install
   npm start
   ```
5. Open http://localhost:3000 in Chrome or Edge.

Demo login:
- Username: `admin`
- Password: `admin123`

## Database and uploads
- SQLite database is created automatically as `pharmacy.db` on first run.
- Prescription image uploads are saved to `uploads/`.
- Demo inventory is seeded the first time the database is created.

## Credits
- Gaurav Singh Bajetha (12613038)
- Aditya Kumar (12613103)
- Adarsh Kumar (12613193)

## Important project notes
- This is an educational demo, not a production pharmacy system.
- Do not upload real patient data or real prescriptions.
- Before any public deployment, change the session secret, use HTTPS and secure cookies, add stronger authorization/validation, and review privacy/security requirements.
- Medicines and GST settings in this demo are examples; verify any tax or pharmacy-specific requirements with your teacher.
