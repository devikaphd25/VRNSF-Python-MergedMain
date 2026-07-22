# VR Learning Platform

A multi-user WebXR learning environment built with the Immersive Web SDK (IWSDK). The platform consists of a virtual classroom and an individual Python Type Lab connected through Socket.IO for real-time communication.

---

# System Architecture

The platform consists of the following components:

| Component | Port | Description |
|-----------|------|-------------|
| Classroom Server | **3001** | Manages classroom logic, instructor controls, student sessions, and communication with the lab. |
| Classroom Client | **8081** | VR classroom experience for students and instructors. |
| Python Type Lab Client | **8082** | Individual Python typing lab environment. |

```
                 +----------------------+
                 | Classroom Server     |
                 |      Port 3001       |
                 +----------+-----------+
                            |
          ---------------------------------------
          |                                     |
+----------------------+              +----------------------+
| Classroom Client     |              | Python Type Lab      |
|      Port 8081       |              |      Port 8082       |
+----------------------+              +----------------------+
```

The Classroom Server coordinates communication between the classroom and the Python Type Lab. Student identity, seat assignment, and learning progress are preserved while transitioning between environments.

---

# Features

- Multi-user VR classroom
- Instructor dashboard
- Student seat selection
- Raise hand functionality
- Presentation mode
- Individual Python Type Lab
- Automatic return to classroom with seat restoration
- Real-time synchronization using Socket.IO

---

# Prerequisites

- Node.js (LTS recommended)
- npm
- WebXR compatible browser or VR headset (optional for development)

---

# Installation

Clone the repository:

```bash
git clone https://github.com/UMESVRTeam/VR-learning.git
cd VR-learning
```

Install dependencies:

```bash
npm install
```

---

# Running the Project

### 1. Start the Classroom Server

```bash
node server.js
```

Expected:

```
CLASSROOM SERVER
Port: 3001
```

---

### 2. Start the Classroom Client

```bash
npm run dev
```

The classroom client runs on:

```
https://localhost:8081
```

---

### 3. Start the Python Type Lab

From the Python Lab project:

```bash
cd ../VR-learning-python-type-lab
npm install
npm run dev
```

The lab client runs on:

```
https://localhost:8082
```

---

# GitHub Workflow

The repository is organized into two development branches.

| Branch | Purpose |
|---------|---------|
| `main` | VR Classroom |
| `feature/python-type-lab` | Python Type Lab |

Recommended local structure:

```
VR-learning-classroom/
    └── main

VR-learning-python-type-lab/
    └── feature/python-type-lab
```

Develop each project in its corresponding branch to keep classroom and lab development independent.

---

# Project Structure

```
VR-learning/
│
├── server.js
├── src/
├── public/
├── ui/
├── package.json
└── vite.config.ts
```

---

# Technologies

- Immersive Web SDK (IWSDK)
- Three.js
- Node.js
- Express
- Socket.IO
- TypeScript
- Vite

---

# License

University of Maryland Eastern Shore (UMES)
