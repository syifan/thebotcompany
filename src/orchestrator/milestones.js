export function normalizeResetTargetMilestone(resetTo) {
    const value = typeof resetTo === 'string' ? resetTo.trim() : '';
    if (!value) return null;
    if (/^root$/i.test(value)) return { milestoneId: null, label: 'root' };
    const current = String(this.currentMilestoneId || '').trim();
    if (!current) return null;
    const candidate = value.replace(/^m/i, 'M');
    const ancestors = [];
    const parts = current.split('.');
    for (let i = parts.length; i >= 1; i--) ancestors.push(parts.slice(0, i).join('.'));
    if (!ancestors.includes(candidate)) return null;
    return { milestoneId: candidate, label: candidate };
  }

export function getParentMilestoneId(milestoneId = null) {
    const value = String(milestoneId || '').trim();
    if (!value || !value.includes('.')) return null;
    return value.split('.').slice(0, -1).join('.') || null;
  }

export async function getMilestoneRecord(milestoneId) {
    if (!milestoneId) return null;
    try {
      const db = this.getDb();
      const row = db.prepare(`SELECT * FROM milestones WHERE milestone_id = ?`).get(milestoneId);
      db.close();
      return row || null;
    } catch {
      return null;
    }
  }

export function makeMilestoneBranchPrefix(milestoneId) {
    return String(milestoneId || 'M0').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

export function slugifyMilestoneTitle(title, { stripLeadingMilestoneId = null } = {}) {
    let normalizedTitle = String(title || 'milestone');
    if (stripLeadingMilestoneId) {
      const escapedMilestoneId = String(stripLeadingMilestoneId)
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\\\./g, '[\\s._-]*');
      normalizedTitle = normalizedTitle.replace(new RegExp(`^\\s*${escapedMilestoneId}(?:[\\s:._-]+|\\b)`, 'i'), '');
    }
    return normalizedTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'milestone';
  }

export async function allocateNextMilestoneId(parentMilestoneId = null) {
    try {
      const db = this.getDb();
      let nextId = 'M1';
      if (parentMilestoneId) {
        const rows = db.prepare(`SELECT milestone_id FROM milestones WHERE parent_milestone_id = ? OR milestone_id LIKE ?`).all(parentMilestoneId, `${parentMilestoneId}.%`);
        let maxChild = 0;
        for (const row of rows) {
          const key = String(row.milestone_id || '');
          const suffix = key.slice(parentMilestoneId.length + 1);
          if (/^\d+$/.test(suffix)) maxChild = Math.max(maxChild, Number(suffix));
        }
        nextId = `${parentMilestoneId}.${maxChild + 1}`;
      } else {
        const rows = db.prepare(`SELECT milestone_id FROM milestones WHERE milestone_id GLOB 'M*'`).all();
        let maxTop = 0;
        for (const row of rows) {
          const m = String(row.milestone_id || '').match(/^M(\d+)$/);
          if (m) maxTop = Math.max(maxTop, Number(m[1]));
        }
        nextId = `M${maxTop + 1}`;
      }
      db.close();
      return nextId;
    } catch {
      if (parentMilestoneId) return `${parentMilestoneId}.1`;
      return `M${(this.epochCount || 0) + 1}`;
    }
  }

export async function allocateNextEpochId() {
    try {
      const db = this.getDb();
      const rows = db.prepare(`SELECT epoch_index FROM tbc_prs WHERE epoch_index IS NOT NULL`).all();
      let maxEpoch = 0;
      for (const row of rows) {
        const m = String(row.epoch_index || '').match(/^E(\d+)$/);
        if (m) maxEpoch = Math.max(maxEpoch, Number(m[1]));
      }
      db.close();
      return `E${maxEpoch + 1}`;
    } catch {
      return `E${(this.epochCount || 0) + 1}`;
    }
  }

export async function upsertMilestoneRecord({ milestoneId, title, description, cyclesBudget, branchName, parentMilestoneId = null, status = 'active', phase = 'implementation', failureReason = null, linkedPrId = null }) {
    if (!milestoneId) return;
    try {
      const db = this.getDb();
      const existing = db.prepare(`SELECT id FROM milestones WHERE milestone_id = ?`).get(milestoneId);
      const now = new Date().toISOString();
      if (existing) {
        db.prepare(`UPDATE milestones SET title = ?, description = ?, cycles_budget = ?, branch_name = ?, parent_milestone_id = ?, linked_pr_id = ?, failure_reason = ?, phase = ?, status = ?, completed_at = CASE WHEN ? = 'completed' THEN COALESCE(completed_at, ?) ELSE completed_at END WHERE milestone_id = ?`)
          .run(title || null, description || '', cyclesBudget || 0, branchName || null, parentMilestoneId || null, linkedPrId || null, failureReason || null, phase, status, status, now, milestoneId);
      } else {
        db.prepare(`INSERT INTO milestones (milestone_id, title, description, cycles_budget, cycles_used, branch_name, parent_milestone_id, linked_pr_id, failure_reason, phase, status) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`)
          .run(milestoneId, title || null, description || '', cyclesBudget || 0, branchName || null, parentMilestoneId || null, linkedPrId || null, failureReason || null, phase, status);
      }
      db.close();
    } catch {}
  }

export async function ensureEpochPRForCurrentMilestone() {
    if (!this.currentMilestoneId || !this.milestoneTitle || !this.currentMilestoneBranch) return null;
    const existing = await this.getOpenEpochPRForCurrentMilestone();
    if (existing) {
      if (!this.currentEpochPrId) this.setState({ currentEpochPrId: existing.id }, { save: true });
      return existing;
    }
    try {
      const db = this.getDb();
      const now = new Date().toISOString();
      const result = db.prepare(`INSERT INTO tbc_prs (title, summary, milestone_id, parent_pr_id, epoch_index, branch_name, base_branch, head_branch, status, decision, decision_reason, issue_ids, test_status, actor, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', NULL, '', '[]', 'unknown', 'ares', 'ares', ?, ?)`).run(
        this.milestoneTitle,
        this.milestoneDescription || '',
        this.currentMilestoneId,
        null,
        this.currentEpochId,
        this.currentMilestoneBranch,
        'main',
        this.currentMilestoneBranch,
        now,
        now,
      );
      const prId = result.lastInsertRowid;
      db.close();
      await this.upsertMilestoneRecord({
        milestoneId: this.currentMilestoneId,
        title: this.milestoneTitle,
        description: this.milestoneDescription,
        cyclesBudget: this.milestoneCyclesBudget,
        branchName: this.currentMilestoneBranch,
        parentMilestoneId: this.currentMilestoneId.includes('.') ? this.currentMilestoneId.split('.').slice(0, -1).join('.') : null,
        linkedPrId: prId,
      });
      this.setState({ currentEpochPrId: prId }, { save: true });
      return await this.getPR(prId);
    } catch {
      return null;
    }
  }

export async function markCurrentMilestoneFailed(reason) {
    if (!this.currentMilestoneId) return;
    await this.upsertMilestoneRecord({
      milestoneId: this.currentMilestoneId,
      title: this.milestoneTitle,
      description: this.milestoneDescription,
      cyclesBudget: this.milestoneCyclesBudget,
      branchName: this.currentMilestoneBranch,
      parentMilestoneId: this.currentMilestoneId.includes('.') ? this.currentMilestoneId.split('.').slice(0, -1).join('.') : null,
      status: 'failed',
      phase: 'athena',
      failureReason: reason || null,
      linkedPrId: this.currentEpochPrId,
    });
  }

export async function markCurrentMilestoneCompleted() {
    if (!this.currentMilestoneId) return;
    await this.upsertMilestoneRecord({
      milestoneId: this.currentMilestoneId,
      title: this.milestoneTitle,
      description: this.milestoneDescription,
      cyclesBudget: this.milestoneCyclesBudget,
      branchName: this.currentMilestoneBranch,
      parentMilestoneId: this.currentMilestoneId.includes('.') ? this.currentMilestoneId.split('.').slice(0, -1).join('.') : null,
      status: 'completed',
      phase: 'athena',
      linkedPrId: this.currentEpochPrId,
    });
  }
