#!/usr/bin/env node
/**
 * TheBotCompany CLI
 * 
 * Usage:
 *   tbc start          Start the orchestrator service
 *   tbc status         Show status of all projects
 *   tbc add <path>     Add a project
 *   tbc remove <id>    Remove a project
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const command = args[0];

async function main() {
  switch (command) {
    case 'start':
      console.log('Starting TheBotCompany...');
      spawn('node', [path.join(__dirname, '..', 'src', 'server.js')], {
        stdio: 'inherit',
        detached: false
      });
      break;

    case 'status':
      try {
        const res = await fetch('http://localhost:3100/api/status');
        const data = await res.json();
        console.log(`TheBotCompany - ${data.projectCount} projects`);
        console.log(`Uptime: ${Math.floor(data.uptime / 60)}m ${data.uptime % 60}s\n`);
        for (const p of data.projects) {
          const status = p.paused ? '⏸️ paused' : p.sleeping ? '💤 sleeping' : p.currentAgent ? `▶️ ${p.currentAgent}` : '⏹️ stopped';
          console.log(`  ${p.id}: ${status} (cycle ${p.cycleCount})`);
        }
      } catch {
        console.log('TheBotCompany is not running');
      }
      break;

    default:
      console.log(`TheBotCompany - Multi-project AI Agent Orchestrator

Usage:
  tbc start      Start the orchestrator service
  tbc status     Show status of all projects
`);
  }
}

main();
