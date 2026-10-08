# 🔐 GPAS Secure

GPAS Secure is a cybersecurity-focused **Graphical Password Authentication System (GPAS)** developed as a B.Tech Mini Project. The system enhances traditional authentication mechanisms by incorporating image-based graphical passwords, secure file storage, audit logging, user management, analytics, and administrative monitoring features.

🌐 **Live Demo:** [gpas-secure.onrender.com](https://gpas-secure.onrender.com)  
💻 **GitHub Repository:** [madhavmanugula/gpas-secure](https://github.com/madhavmanugula/gpas-secure)

### Project Status

The application is deployed and available online.

---

## 🚀 Features

### 🔑 Authentication & Security

* Graphical Password Authentication
* Image-Based User Login
* Password Reset via Image Verification
* CAPTCHA Verification
* Account Lock Protection for Invalid Attempts
* Suspicious Activity Detection
* Session Monitoring & Security Controls

### 📁 File Vault

* Secure File Upload
* Secure File Access
* File Download Management
* File Deletion Management
* Automatic Cleanup of Unused Files

### 👨‍💼 Administration

* Admin Dashboard
* User Management
* Role-Based Access Control
* Audit Logging
* Activity Monitoring

### 📊 Analytics

* User Statistics
* File Usage Analytics
* Security Event Monitoring
* Dashboard Insights & Reports

---

## 🛠️ Technologies Used

| Technology | Purpose                         |
| ---------- | ------------------------------- |
| HTML5      | Frontend Structure              |
| CSS3       | User Interface Design           |
| JavaScript | Client-Side Functionality       |
| Node.js    | Backend Runtime                 |
| Express.js | Web Framework                   |
| MySQL      | Database Management             |
| Aiven MySQL | Production cloud database       |
| Cloudinary | Cloud image storage for graphical password and user images |
| Multer     | File Upload Handling            |
| dotenv     | Environment Variable Management |
| bcrypt     | Password Security               |
| cors       | Cross-Origin Resource Sharing   |

---

## 📂 Project Structure

```text
gpas-secure/
│
├── docs/
│   ├── GPAS_Secure_FinalReview.pptx
│   └── OUTPUT SCREENSHOTS.docx
│
├── public/
│   ├── css/
│   │   └── style.css
│   │
│   ├── js/
│   │   ├── admin.js
│   │   ├── dashboard.js
│   │   ├── forgot.js
│   │   ├── login.js
│   │   ├── register.js
│   │   └── reset.js
│   │
│   ├── admin.html
│   ├── dashboard.html
│   ├── forgot.html
│   ├── index.html
│   ├── login.html
│   ├── register.html
│   └── reset.html
│
├── .env.example
├── .gitignore
├── .hintrc
├── package.json
├── package-lock.json
├── README.md
└── server.js
```

---

## ⚙️ Installation

### Local Development Setup

### 1️⃣ Clone the Repository

```bash
git clone https://github.com/madhavmanugula/gpas-secure.git
cd gpas-secure
```

### 2️⃣ Install Dependencies

```bash
npm install
```

### 3️⃣ Configure Environment Variables

Create a local `.env` file in the project root using `.env.example` as a reference, and provide the values for your local development environment. Keep credentials and secrets out of the README and do not commit your `.env` file.

### 4️⃣ Start the Application

```bash
node server.js
```

The application will be available at:

```text
http://localhost:3001
```

---

## 🌐 Deployment

The deployed application uses the following architecture:

| Component | Service |
| --------- | ------- |
| Source code | GitHub |
| Application hosting | Render (Node.js/Express) |
| Production database | Aiven MySQL |
| Graphical password and user image storage | Cloudinary |

**Live application:** [https://gpas-secure.onrender.com](https://gpas-secure.onrender.com)

---

## 🔒 Security Features

* Graphical Password Authentication
* CAPTCHA Verification
* Audit Logging
* Role-Based Access Control
* Account Lock Mechanism
* Suspicious Activity Detection
* Secure File Management
* Session Monitoring
* Activity Tracking
* Administrative Security Monitoring

---

## 📊 Project Demonstration

Detailed project outputs, screenshots, workflow diagrams, and presentation materials are available in the **docs** directory.

### Documentation Files

```text
docs/
├── GPAS_Secure_FinalReview.pptx
└── OUTPUT SCREENSHOTS.docx
```

### Included Demonstrations

* User Registration Workflow
* Graphical Password Setup
* Secure Login Process
* Password Reset Mechanism
* User Dashboard
* File Vault Operations
* Admin Dashboard
* User Management
* Audit Logs
* Security Monitoring
* Analytics Dashboard
* System Outputs & Results

These documents provide a comprehensive overview of the system architecture, implementation, user interface, security mechanisms, and project outcomes.

---

## 🎯 Project Objectives

* Enhance authentication security using graphical passwords.
* Reduce vulnerabilities associated with traditional text-based passwords.
* Provide secure file storage and management capabilities.
* Implement administrative monitoring and auditing features.
* Track user activities and security events.
* Generate meaningful analytics for system management.

---

## 👨‍💻 Author

**Madhav Manugula**

B.Tech – Computer Science & Engineering
AVN Institute of Engineering & Technology

### Project Contribution

This project was developed as part of a college mini project.

Primary development, backend implementation, security features, file vault integration, admin dashboard, analytics module, audit logging, and overall system integration were completed by **Madhav Manugula**.

---

## 📈 Future Enhancements

* Multi-Factor Authentication (MFA)
* Email-Based Verification
* Advanced Security Analytics
* Real-Time Notifications
* Enhanced User Reporting
* Advanced Access Control Mechanisms
* Improved Security Monitoring Dashboard

---

## 📜 License

This project is intended for educational and academic purposes only.

---

## ⭐ Support

If you found this project useful, consider giving the repository a **Star ⭐** on GitHub.

Your support is appreciated and helps showcase the project to a wider audience.

---

## ✨ What's New in v1.1.0

* Cloud deployment
* Render application hosting
* Aiven MySQL production database
* Cloudinary image storage for graphical password and user images
* Production environment configuration

---

### 🚀 GPAS Secure v1.1.0

*A modern Graphical Password Authentication System focused on security, usability, administration, and monitoring.*
