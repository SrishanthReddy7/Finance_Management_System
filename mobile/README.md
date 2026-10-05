# Finance Hub — Mobile Application (React Native)

This is the mobile application for the **Finance Management System**, built using **React Native** and **Expo**. It connects to the exact same backend API as the web frontend.

---

## 📱 Features

1. **Authentication & Session Persistence**:
   - Secure login with JWT tokens stored in device storage (`@react-native-async-storage/async-storage`).
   - Automatic session restore on app launch.
   - Built-in **Server Settings** modal allowing real-time switching and ping-testing of API endpoints (Localhost, Android Emulator `10.0.2.2`, or Wi-Fi LAN IP).

2. **Executive & Employee Dashboard**:
   - Personalized greeting with Employee Code, Role, and Department.
   - Live metrics summary: Pending Claims amount, Approved Reimbursements.
   - Quick Action buttons: New Expense, View Invoices, Approvals, My Payslips.
   - Recent expense claims list with direct navigation to details.

3. **Expense Claims & Reimbursements**:
   - **My Expenses List**: Filter claims by status (`ALL`, `DRAFT`, `SUBMITTED`, `APPROVED`, `REIMBURSED`, `REJECTED`).
   - **Submit Claim**: Capture receipts with Camera or select from Photo Library (`expo-image-picker`), auto-populates categories from `/expenses/categories` and projects from `/projects`.
   - **Expense Detail & Lifecycle**: Complete audit timeline (Submitted ➔ Manager Review ➔ Finance Review ➔ Reimbursement).
   - **Approval Actions**: Managers and Admins can directly Approve or Reject claims with comments.

4. **Client Invoices**:
   - Search and filter invoices (`ISSUED`, `PARTIALLY_PAID`, `PAID`, `OVERDUE`).
   - Detailed invoice breakdown with client information, itemized line items, GST tax splits (CGST, SGST, IGST), and balance due.

5. **My Payslips**:
   - View monthly payslips history.
   - Expandable breakdown of Gross Salary (Basic, HRA, Allowances) vs Deductions (PF, Professional Tax, TDS) and Net Take-Home pay.

6. **Profile & Device Configuration**:
   - View linked employee employment records.
   - Configure backend API base URL with instant ping status test.
   - Secure sign out.

---

## 🚀 Getting Started

### 1. Prerequisites
- **Node.js** (v18 or higher recommended)
- **Expo Go** app installed on your physical mobile phone (available on Google Play Store & Apple App Store), OR an Android/iOS emulator installed on your computer.

### 2. Install Dependencies
Open a terminal in the `mobile` folder:
```bash
cd mobile
npm install
```

### 3. Start the Backend API
Make sure the backend is running in another terminal:
```bash
cd backend
npm run dev
```
*(The backend runs on port 5000: `http://localhost:5000/api/v1`)*

### 4. Start the Mobile App
From the `mobile` directory:
```bash
npm start
```
This launches the Expo CLI with a QR code in your terminal.

- **To run on your physical phone**: Open the **Expo Go** app and scan the QR code displayed in the terminal.
- **To run on Android Emulator**: Press `a` in the terminal.
- **To run in Web browser**: Press `w` in the terminal.

---

## 🌐 Connecting Mobile App to Your Local Backend

| Device / Environment | API Base URL to Use |
| :--- | :--- |
| **Android Emulator** | `http://10.0.2.2:5000/api/v1` *(Default on Android)* |
| **iOS Simulator / Web** | `http://localhost:5000/api/v1` *(Default on iOS/Web)* |
> **Pro-Tip**: You don't need to change any code! In the mobile app's Login screen or Profile screen, tap **"⚙️ Server"**, enter or select your IP, and tap **"Test Ping"** to verify connection instantly.

---

## 👥 Demo User Accounts (Ready to Test)

All seeded test accounts use the password: **`Passw0rd!123`**

| Role | Email | Best For Testing |
| :--- | :--- | :--- |
| **CEO / Super Admin** | `ceo@company.test` | System-wide view, full executive access |
| **Finance Admin** | `finance@company.test` | Client invoices, finance review & reimbursement payouts |
| **HR Admin** | `hr@company.test` | HR administration portal, onboarding & employee status |
| **Manager** | `manager@company.test` | Manager review & approval of employee expense claims |
| **Employee A** | `employee.a@company.test` | Submitting expense claims & viewing payslips |

> **Quick Login**: On the mobile login screen, tap any of the demo chips (**HR Admin**, **CEO**, **Finance**, **Manager**, **Employee A**) to instantly autofill credentials.

