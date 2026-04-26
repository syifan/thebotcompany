import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

/**
 * In-process orchestrator boundary.
 *
 * The API server should talk to this object instead of owning runner lifecycle
 * directly. Today this wraps ProjectRunner instances in memory; later the same
 * surface can be backed by per-project socket/HTTP orchestrator processes.
 */
export class LocalOrchestrator {
  constructor({ tbcHome, RunnerClass, projects = new Map(), log = () => {} }) {
    this.tbcHome = tbcHome;
    this.RunnerClass = RunnerClass;
    this.log = log;
    this.projects = projects;
  }

  get registryPath() {
    return path.join(this.tbcHome, 'projects.yaml');
  }

  ensureRegistryFile() {
    if (fs.existsSync(this.registryPath)) return;
    const defaultConfig = `# TheBotCompany - Project Registry
projects:
  # Example:
  # m2sim:
  #   path: ~/dev/src/github.com/sarchlab/m2sim
  #   enabled: true
`;
    fs.writeFileSync(this.registryPath, defaultConfig);
    this.log(`Created ${this.registryPath}`);
  }

  loadRegistryConfig() {
    this.ensureRegistryFile();
    const raw = fs.readFileSync(this.registryPath, 'utf-8');
    const config = yaml.load(raw) || {};
    if (!config.projects) config.projects = {};
    return config;
  }

  saveRegistryConfig(config) {
    fs.writeFileSync(this.registryPath, yaml.dump(config, { lineWidth: -1 }));
  }

  loadProjectRegistry() {
    try {
      return this.loadRegistryConfig().projects || {};
    } catch (e) {
      this.log(`Failed to load projects.yaml: ${e.message}`);
      return {};
    }
  }

  syncProjects() {
    const config = this.loadProjectRegistry();

    for (const [id, cfg] of Object.entries(config)) {
      if (!this.projects.has(id)) {
        const runner = new this.RunnerClass(id, cfg);
        this.projects.set(id, runner);
        if (runner.enabled) runner.start();
      }
    }

    for (const [id, runner] of this.projects) {
      if (!(id in config)) {
        runner.stop();
        this.projects.delete(id);
      }
    }
  }

  listProjects() {
    return Array.from(this.projects.values());
  }

  getProject(id) {
    return this.projects.get(id) || null;
  }

  hasProject(id) {
    return this.projects.has(id);
  }

  deleteProject(id) {
    const runner = this.projects.get(id);
    if (runner) runner.stop();
    return this.projects.delete(id);
  }

  setProject(id, runner) {
    this.projects.set(id, runner);
    return runner;
  }

  addProjectConfig(id, cfg) {
    const config = this.loadRegistryConfig();
    config.projects[id] = cfg;
    this.saveRegistryConfig(config);
  }

  removeProjectConfig(id) {
    const config = this.loadRegistryConfig();
    if (!config.projects[id]) return false;
    this.deleteProject(id);
    delete config.projects[id];
    this.saveRegistryConfig(config);
    return true;
  }

  setProjectArchived(id, archived) {
    const config = this.loadRegistryConfig();
    if (!config.projects[id]) return false;
    if (archived) {
      config.projects[id].archived = true;
    } else {
      delete config.projects[id].archived;
    }
    this.saveRegistryConfig(config);
    const runner = this.getProject(id);
    if (runner) runner.archived = archived;
    return true;
  }

  projectCount() {
    return this.projects.size;
  }

  listProjectStatuses() {
    return this.listProjects().map(project => project.getStatus());
  }

  getStatus(id) {
    return this.getProject(id)?.getStatus() || null;
  }

  dispatchProjectAction(id, action) {
    const runner = this.getProject(id);
    if (!runner) return false;
    switch (action) {
      case 'pause': runner.pause(); break;
      case 'resume': runner.resume(); break;
      case 'skip': runner.skip(); break;
      case 'start': runner.start(); break;
      case 'stop': runner.stop(); break;
      case 'kill-run': runner.killRun(); break;
      case 'kill-cycle': runner.killCycle(); break;
      case 'kill-epoch': runner.killEpoch(); break;
      default: return false;
    }
    return true;
  }
}
