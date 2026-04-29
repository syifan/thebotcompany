import fs from 'fs';
import path from 'path';

export function getAgentFilesystemPolicy(runner, agent, visibility = null) {
    if (agent.name === 'doctor') {
      return {
        read: [runner.projectDir],
        write: [runner.projectDir],
        denied: [],
        dbPath: null,
        projectDir: runner.projectDir,
      };
    }
    const visMode = visibility?.mode || 'full';
    const repoDir = runner.path;
    const knowledgeDir = runner.knowledgeDir;
    const ownWorkspaceDir = path.join(runner.agentsDir, agent.name);
    const read = [repoDir];
    const write = [repoDir];
    if (visMode !== 'blind') {
      read.push(knowledgeDir);
      read.push(ownWorkspaceDir);
      write.push(knowledgeDir);
      write.push(ownWorkspaceDir);
    }
    if (agent.isManager && visMode !== 'blind') {
      read.push(runner.workerSkillsDir);
      write.push(runner.workerSkillsDir);
    }
    const denied = [
      runner.agentsDir,
      runner.responsesDir,
      runner.uploadsDir,
      runner.skillsDir,
      runner.statePath,
      runner.orchestratorLogPath,
      runner.projectDbPath,
    ];
    return { read, write, denied, dbPath: runner.projectDbPath, projectDir: runner.projectDir };
  }

export function buildAgentPrompt(runner, agent, task, visibility, { root }) {
    const skillPath = agent.isManager
      ? path.join(root, 'agent', 'managers', `${agent.name}.md`)
      : path.join(runner.workerSkillsDir, `${agent.name}.md`);

    if (!fs.existsSync(skillPath)) {
      return null;
    }

    let skillContent = fs.readFileSync(skillPath, 'utf-8');

    // Build shared rules: everyone.md + folder_structure.md + db.md + role-specific rules
    let sharedRules = '';
    try {
      const everyonePath = path.join(root, 'agent', 'everyone.md');
      const folderStructurePath = path.join(root, 'agent', 'folder_structure.md');
      sharedRules = fs.readFileSync(everyonePath, 'utf-8') + '\n\n---\n\n';
      try {
        sharedRules += fs.readFileSync(folderStructurePath, 'utf-8') + '\n\n---\n\n';
      } catch {}
      const visMode = visibility?.mode || 'full';
      if (visMode === 'full') {
        const dbPath = path.join(root, 'agent', 'db.md');
        try {
          const dbContent = fs.readFileSync(dbPath, 'utf-8');
          sharedRules += dbContent + '\n\n---\n\n';
        } catch {}
      }
      if (agent.name !== 'themis') {
        if (visMode === 'focused') {
          sharedRules += '\n> **You are in focused mode.** You cannot read the issue tracker or PR board. Work only from the task, the repository, shared knowledge, and your own agent notes. If needed, you may create a new issue or PR record, or add comments to issues/PRs, to report a blocker or finding.\n\n---\n\n';
        } else if (visMode === 'blind') {
          sharedRules += '\n> **You are in blind mode.** You cannot read the issue tracker or PR board, and you cannot rely on shared knowledge or any agent notes, including your own prior notes. Work only from the task and the repository. If needed, you may create a new issue or PR record, or add comments to issues/PRs, to report a blocker or finding.\n\n---\n\n';
        }
      } else {
        sharedRules += '\n> **You are Themis, final examination manager.** You run in full view, not blind. Inspect the repository, issue tracker, PR board, shared knowledge, and agent notes directly. You may hire and schedule workers, but only workers who report to you. Your examination team is independent from the Athena, Ares, and Apollo teams, so make your own judgment from primary evidence.\n\n---\n\n';
      }
      const rolePath = path.join(root, 'agent', agent.isManager ? 'manager.md' : 'worker.md');
      sharedRules += fs.readFileSync(rolePath, 'utf-8') + '\n\n---\n\n';
      if (agent.isManager) {
        const managerName = String(agent.name || '').toLowerCase();
        const workers = runner.loadAgents().workers
          .filter(worker => String(worker.reportsTo || '').toLowerCase() === managerName)
          .map(worker => `- ${worker.name}${worker.role ? ` — ${worker.role}` : ''}`)
          .sort();
        sharedRules += `# Available workers for ${agent.name}\n\nOnly schedule workers from this exact roster. Do not invent worker names.\n${workers.length ? workers.join('\n') : '- (none)'}\n\n---\n\n`;
      }
    } catch {}

    let taskHeader = '';
    if (task) {
      taskHeader = `> **Your assignment: ${task}**\n\n`;
    }

    // Strip YAML frontmatter (---...---) from skill content before building prompt
    skillContent = skillContent.replace(/^---[\s\S]*?---\n*/, '');
    skillContent = (taskHeader + sharedRules + skillContent).replaceAll('{project_dir}', runner.projectDir);

    return skillContent;
  }
