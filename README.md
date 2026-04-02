<div align="center">
  <img src="frontend/public/logo.png" alt="Flux" width="96" />
  <h1>Flux</h1>
  <p><strong>AI-powered visual workflow automation platform</strong></p>

  <p>
    <img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
    <img src="https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=black" alt="React" />
    <img src="https://img.shields.io/badge/Fastify-5.x-000000?style=flat-square&logo=fastify&logoColor=white" alt="Fastify" />
    <img src="https://img.shields.io/badge/MongoDB-7-47A248?style=flat-square&logo=mongodb&logoColor=white" alt="MongoDB" />
    <img src="https://img.shields.io/badge/Redis-7-DC382D?style=flat-square&logo=redis&logoColor=white" alt="Redis" />
    <img src="https://img.shields.io/badge/Docker-ready-2496ED?style=flat-square&logo=docker&logoColor=white" alt="Docker" />
    <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="MIT License" />
  </p>

  <p>
    <a href="#-features">Features</a> ·
    <a href="#-tech-stack">Tech Stack</a> ·
    <a href="#-getting-started">Getting Started</a> ·
    <a href="#-environment-variables">Environment Variables</a> ·
    <a href="#-docker">Docker</a> ·
    <a href="#-project-structure">Project Structure</a>
  </p>
</div>

---

## Overview

**Flux** is a self-hosted, visual workflow automation platform that lets you build, run, and monitor multi-step automated workflows through a drag-and-drop canvas. Connect AI language models (OpenAI, Anthropic, Google Gemini), web services, and your favourite productivity tools — no scripting required.

Think of it as your own private n8n, purpose-built for teams that want full control over their automation infrastructure and AI integrations.

---

## ✨ Features

### Canvas & Workflow Builder
- **Drag-and-drop canvas** powered by React Flow — visually connect nodes to build workflows
- **Viewport persistence** — zoom and pan position saved per-workflow and restored on revisit
- **Keyboard shortcut** — `Ctrl+S` / `Cmd+S` to save the active workflow instantly
- **Live dirty indicator** — unsaved changes marked with a dot in the toolbar
- **Projects** — group workflows into collapsible project folders via the sidebar
- **Inline rename & drag-to-reorder** — manage workflows without leaving the canvas

### Node Types
| Node | Description |
|------|-------------|
| **Trigger** | Start a workflow manually, via webhook, on a schedule (cron), or on a poll interval |
| **LLM** | Chat with OpenAI, Anthropic, or Google Gemini; maintains per-execution conversation memory |
| **HTTP** | Make arbitrary HTTP requests with custom headers, body, and auth |
| **Condition** | Branch execution based on a boolean expression |
| **Switch** | Multi-branch routing based on field values |
| **Transform** | Reshape data with field mappings and JSONPath expressions |
| **Output** | Capture and expose the final result of a workflow |

### Integrations (OAuth 2.0)
- **Google Workspace** — Gmail (send), Google Drive (upload/list), Google Docs (read/write), Google Sheets (read/append)
- **Slack** — send messages, DMs, and files to any channel or workspace
- **Microsoft Teams** — send messages to Teams channels via Microsoft Graph
- **Basecamp** — create to-dos, assign them to people, and manage projects

### AI & LLM
- Multi-provider support: **OpenAI**, **Anthropic Claude**, **Google Gemini**
- Model picker dropdown with curated model lists per provider
- Per-execution **chat memory** — nodes remember prior messages within a run
- System prompt + user prompt with **template expressions** (`{{ nodes.nodeName.output }}`)

### Platform
- **Execution engine** — reliable queue-backed execution via BullMQ + Redis
- **Execution logs** — step-by-step status, output preview, and token usage per node
- **Node test panel** — test individual nodes in isolation before running the full workflow
- **Credentials manager** — centrally manage all OAuth tokens and API keys
- **API key gate** — lightweight auth layer for self-hosted deployments
- **Dark / light mode** — fully themed UI

---

## 🛠 Tech Stack

### Backend
| Technology | Purpose |
|-----------|---------|
| **Node.js + TypeScript** | Runtime & type safety |
| **Fastify** | High-performance HTTP API server |
| **MongoDB + Mongoose** | Workflow and execution persistence |
| **Redis + BullMQ** | Job queue for async workflow execution |
| **node-cron** | Cron-based trigger scheduling |
| **Zod** | Runtime schema validation |
| **openai / @anthropic-ai/sdk / @google/generative-ai** | LLM provider SDKs |
| **googleapis / @slack/web-api / @microsoft/microsoft-graph-client** | Integration SDKs |

### Frontend
| Technology | Purpose |
|-----------|---------|
| **React 18 + TypeScript** | UI framework |
| **Vite** | Build tool & dev server |
| **@xyflow/react (React Flow)** | Interactive node canvas |
| **Zustand** | Client-side state management |
| **TanStack Query** | Server state, caching, and mutations |
| **Tailwind CSS** | Utility-first styling |
| **Lucide React** | Icon library |

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** v20 or later
- **MongoDB** v7 (local or cloud, e.g. MongoDB Atlas)
- **Redis** v7 (local or cloud, e.g. Upstash)
- API keys for any LLM providers you want to use

### 1 · Clone the repository

```bash
git clone https://github.com/jomael-gemota/workflow-automation-platform.git
cd workflow-automation-platform
```

### 2 · Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` with your values — see [Environment Variables](#-environment-variables) for full details.

### 3 · Install dependencies

```bash
# Backend
npm install

# Frontend
cd frontend && npm install && cd ..
```

### 4 · Run in development mode

```bash
# Terminal 1 — backend API (hot-reload)
npm run dev

# Terminal 2 — frontend dev server
cd frontend && npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### 5 · Production build

```bash
# Build frontend into dist/public, then start the backend which serves it
cd frontend && npm run build && cd ..
npm run build
npm start
```

The app is then served at [http://localhost:3000](http://localhost:3000).

---

## 🔑 Environment Variables

Copy `.env.example` to `.env` and fill in the values below.

### Core

| Variable | Description |
|----------|-------------|
| `PORT` | Port the backend listens on (default `3000`) |
| `MONGODB_URI` | MongoDB connection string |
| `REDIS_URL` | Redis connection string (default `redis://localhost:6379`) |
| `CORS_ORIGIN` | Frontend origin allowed by CORS (default `http://localhost:5173`) |

### LLM Providers

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | OpenAI API key |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `GOOGLE_API_KEY` | Google Gemini API key |

### Google Workspace OAuth

| Variable | Description |
|----------|-------------|
| `GOOGLE_CLIENT_ID` | OAuth 2.0 client ID from Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | OAuth 2.0 client secret |
| `GOOGLE_REDIRECT_URI` | Redirect URI (e.g. `http://localhost:3000/api/oauth/google/callback`) |

### Slack OAuth

| Variable | Description |
|----------|-------------|
| `SLACK_CLIENT_ID` | Slack app client ID |
| `SLACK_CLIENT_SECRET` | Slack app client secret |
| `SLACK_REDIRECT_URI` | Redirect URI (e.g. `http://localhost:3000/api/oauth/slack/callback`) |

### Microsoft Teams OAuth

| Variable | Description |
|----------|-------------|
| `TEAMS_CLIENT_ID` | Azure app client ID |
| `TEAMS_CLIENT_SECRET` | Azure app client secret |
| `TEAMS_TENANT_ID` | Tenant ID (use `common` for multi-tenant) |
| `TEAMS_REDIRECT_URI` | Redirect URI |

### Basecamp OAuth

| Variable | Description |
|----------|-------------|
| `BASECAMP_CLIENT_ID` | Basecamp app client ID |
| `BASECAMP_CLIENT_SECRET` | Basecamp app client secret |
| `BASECAMP_REDIRECT_URI` | Redirect URI |

---

## 🐳 Docker

The easiest way to run the full stack locally is with Docker Compose — it spins up the app, MongoDB, and Redis together.

```bash
# Copy and fill in your environment variables
cp .env.example .env

# Build and start all services
docker compose up --build
```

The app will be available at [http://localhost:3000](http://localhost:3000).

```bash
# Stop all services
docker compose down

# Stop and remove all data volumes
docker compose down -v
```

> **Deploying to Railway?**  
> Set all environment variables in your Railway project's Variables panel. MongoDB and Redis can be provisioned as Railway plugins or pointed at external services like Atlas and Upstash.

---

## 📁 Project Structure

```
flux/
├── src/                        # Backend (Node.js / Fastify)
│   ├── db/                     # Database connection & seed data
│   ├── engine/                 # Workflow execution engine
│   ├── llm/                    # LLM providers (OpenAI, Anthropic, Gemini)
│   │   └── providers/
│   ├── nodes/                  # Node executor implementations
│   ├── queue/                  # BullMQ job queue setup
│   ├── repositories/           # MongoDB data access layer
│   ├── routes/                 # Fastify API routes
│   ├── scheduler/              # Cron & polling trigger scheduler
│   ├── services/               # OAuth & credential services
│   ├── types/                  # Shared TypeScript types
│   ├── validation/             # Zod schemas
│   └── index.ts                # App entry point
│
├── frontend/                   # Frontend (React / Vite)
│   ├── public/
│   │   ├── logo.png            # Flux app logo
│   │   └── logos/              # Integration brand logos
│   └── src/
│       ├── api/                # API client functions
│       ├── components/
│       │   ├── canvas/         # React Flow canvas & node picker
│       │   ├── nodes/          # Node widgets & icons
│       │   ├── panels/         # Config panel & execution log panel
│       │   └── ui/             # Shared UI components
│       ├── hooks/              # React Query hooks (workflows, credentials, etc.)
│       ├── store/              # Zustand global state
│       └── types/              # Frontend TypeScript types
│
├── docker-compose.yml
├── Dockerfile
├── .env.example
└── package.json
```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

---

<div align="center">
  <p>Built by <a href="https://github.com/jomael-gemota">Jomael Gemota</a></p>
</div>
