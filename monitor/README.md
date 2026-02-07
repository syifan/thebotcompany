# ML Perf Survey Monitor

A React.js monitoring dashboard for the ML Performance Survey orchestrator.

## Features

- **Orchestrator State**: Displays cycle count and current agent index
- **Live Logs**: Tails the last 100 lines of `orchestrator.log`
- **Human Agents**: Lists agents from `../agent/humans/` folder
- **God Agents**: Lists agents from `../agent/gods/` folder
- **Config Display**: Shows current `config.yaml`
- **Auto-refresh**: Updates every 5 seconds

## Stack

- React.js + Vite
- Tailwind CSS
- Express.js backend
- shadcn/ui components (minimal, neutral theme)

## Quick Start

```bash
# Install dependencies
npm install

# Start both frontend and backend
npm run dev
```

The dashboard will be available at http://localhost:5173

## API Endpoints

The Express backend (port 3001) provides:

- `GET /api/state` - Orchestrator state from `state.json`
- `GET /api/logs?lines=N` - Last N lines from `orchestrator.log`
- `GET /api/agents` - Lists human and god agents
- `GET /api/config` - Current config from `config.yaml`

## Scripts

- `npm run dev` - Start both client and server (development)
- `npm run client` - Start Vite dev server only
- `npm run server` - Start Express API server only
- `npm run build` - Build for production
- `npm run preview` - Preview production build

## File Structure

```
monitor/
├── server/
│   └── index.js          # Express API server
├── src/
│   ├── components/
│   │   └── ui/           # shadcn-style components
│   ├── lib/
│   │   └── utils.js      # Utility functions
│   ├── App.jsx           # Main dashboard component
│   ├── main.jsx          # React entry point
│   └── index.css         # Tailwind styles
├── index.html
├── package.json
├── vite.config.js
├── tailwind.config.js
└── postcss.config.js
```
