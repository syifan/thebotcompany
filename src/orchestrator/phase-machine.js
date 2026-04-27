export async function runRunnerLoop(runner, deps = {}) {
    const broadcastEvent = deps.broadcastEvent || (() => {});
    while (runner.running) {
      while (runner.isPaused && runner.running) {
        await deps.sleep(1000);
      }
      if (!runner.running) break;

      const config = runner.loadConfig();

      // Check budget before starting cycle
      const budgetStatus = runner.getBudgetStatus();
      if (budgetStatus && budgetStatus.exhausted) {
        deps.log(`Budget exhausted ($${budgetStatus.spent24h.toFixed(2)}/$${budgetStatus.budgetPer24h}), waiting for budget to roll off`, runner.id);
        runner.setState({ isPaused: true, pauseReason: `Budget exhausted: $${budgetStatus.spent24h.toFixed(2)} / $${budgetStatus.budgetPer24h} (24h)` });
        // Re-check every 2 hours until budget rolls off or manually resumed
        await runner._autoPauseWait(2 * 60 * 60 * 1000, () => !runner.getBudgetStatus().exhausted);
        if (!runner.running) break;
        continue;
      }

      // Check if any API key is available before starting a cycle
      const preConfig = runner.loadConfig();
      const poolCheck = deps.getKeyPoolSafe();
      if (poolCheck.keys.filter(k => k.enabled).length === 0 && !preConfig.setupToken) {
        deps.log(`No API keys configured. Pausing project. Add a key in Settings > Credentials.`, runner.id);
        runner.setState({ isPaused: true, pauseReason: 'No API keys configured. Add one in Settings > Credentials.' });
        await runner._autoPauseWait(30_000, () => deps.getKeyPoolSafe().keys.some(k => k.enabled));
        if (!runner.running) break;
        continue;
      }

      const { managers, workers } = runner.loadAgents();

      // Start new cycle — preserve schedule state if resuming from reboot
      runner.abortCurrentCycle = false;
      const resuming = !!runner.currentSchedule;
      if (!resuming) {
        runner.cycleCount++;
        runner.completedAgents = [];
        runner.saveState();
      }
      deps.log(`===== CYCLE ${runner.cycleCount} (phase: ${runner.phase})${resuming ? ' [RESUMING]' : ''} =====`, runner.id);

      let cycleFailures = 0;
      let cycleTotal = 0;

      // ===== PHASE: ATHENA (strategy) =====
      if (runner.phase === 'athena') {
        const athena = managers.find(m => m.name === 'athena');
        if (athena) {
          // Build situation context for Athena
          if (!runner.pendingMilestoneId) {
            const parentMilestoneId = runner.currentMilestoneId || null;
            runner.pendingMilestoneId = await runner.allocateNextMilestoneId(parentMilestoneId);
            runner.saveState();
          }
          const reservedBranchPrefix = runner.makeMilestoneBranchPrefix(runner.pendingMilestoneId);

          let situation = '';
          if (runner.examinationFeedback) {
            situation = `> **Situation: Project Completion Rejected by Themis**\n> ${runner.examinationFeedback}\n\n`;
          } else if (!runner.milestoneDescription) {
            situation = '> **Situation: Project Just Started**\n\n';
          } else if (runner.verificationFeedback === '__passed__') {
            situation = '> **Situation: Milestone Verified Complete**\n> Previous milestone was verified by Apollo\'s team.\n\n';
          } else if (runner.verificationFeedback) {
            situation = `> **Situation: Epoch PR Rejected by Apollo**\n> ${runner.verificationFeedback}\n> Previous milestone: ${runner.currentMilestoneId || 'unknown'}\n> Previous branch: ${runner.currentMilestoneBranch || 'unknown'}\n> Athena should split or narrow the failed milestone into a new PR-sized milestone, not send it back as a generic fix round.\n\n`;
          } else {
            situation = `> **Situation: Implementation Deadline Missed**\n> Ares's team used ${runner.milestoneCyclesUsed}/${runner.milestoneCyclesBudget} cycles without completing the milestone.\n> Previous milestone: ${runner.currentMilestoneId || 'unknown'}\n> Current branch: ${runner.currentMilestoneBranch || 'not set'}\n\n`;
          }
          situation += `> **Assigned milestone ID:** ${runner.pendingMilestoneId}\n> **Reserved branch prefix:** ${reservedBranchPrefix}\n`;
          if (runner.currentMilestoneId) {
            situation += `> **Optional reset:** If the current subtree is wrong, you may return a milestone with \"reset_to\": \"${runner.currentMilestoneId}\" or any ancestor milestone id (or \"root\") to abandon deeper branches and replan from that level.\n`;
          }
          situation += `\n`;

          const result = await runner.runAgent(athena, config, null, situation);
          cycleTotal++;
          if (!result || !result.success) cycleFailures++;

          // Parse schedule and milestone from Athena's response
          let schedule = null;
          if (result && result.resultText) {
            schedule = runner.parseSchedule(result.resultText);
            if (schedule) {
              deps.log(`Schedule: ${JSON.stringify(schedule)}`, runner.id);
            }

            const milestoneMatch = result.resultText.match(/<!-- MILESTONE -->\s*([\s\S]*?)\s*<!-- \/MILESTONE -->/);
            if (milestoneMatch) {
              try {
                const milestone = JSON.parse(milestoneMatch[1]);
                const milestoneTitle = milestone.title || milestone.description.slice(0, 80);
                const resetTarget = runner.normalizeResetTargetMilestone(milestone.reset_to);
                const resetTo = resetTarget ? resetTarget.milestoneId : (runner.currentMilestoneId || null);
                const shouldReusePendingMilestoneId = !!runner.pendingMilestoneId && resetTo === (runner.currentMilestoneId || null);
                const milestoneId = shouldReusePendingMilestoneId
                  ? runner.pendingMilestoneId
                  : await runner.allocateNextMilestoneId(resetTo);
                if (milestone.reset_to && !resetTarget) {
                  deps.log(`Ignoring invalid reset_to target from Athena: ${milestone.reset_to}`, runner.id);
                } else if (milestone.reset_to && resetTarget) {
                  deps.log(`Athena reset planning anchor to ${resetTarget.label}`, runner.id);
                  if (runner.currentMilestoneBranch) {
                    runner.closeOpenEpochPRForBranch(runner.currentMilestoneBranch, {
                      actor: 'athena',
                      reason: `Athena reset subtree to ${resetTarget.label} while replanning.`,
                    });
                  }
                }
                runner.setState({
                  milestoneTitle,
                  milestoneDescription: milestone.description,
                  milestoneCyclesBudget: milestone.cycles || 20,
                  milestoneCyclesUsed: 0,
                  currentMilestoneId: milestoneId,
                  pendingMilestoneId: null,
                  currentEpochId: null,
                  currentEpochPrId: null,
                  currentMilestoneBranch: null,
                  aresGraceCycleUsed: false,
                  verificationFeedback: null,
                  examinationFeedback: null,
                  pendingCompletionMessage: null,
                  isFixRound: false,
                  phase: 'implementation',
                });
                await runner.upsertMilestoneRecord({
                  milestoneId,
                  title: milestoneTitle,
                  description: milestone.description,
                  cyclesBudget: milestone.cycles || 20,
                  branchName: null,
                  parentMilestoneId: milestoneId.includes('.') ? milestoneId.split('.').slice(0, -1).join('.') : null,
                  phase: 'implementation',
                  status: 'active',
                });
                runner.epochCount++;
                runner.saveState();
                deps.log(`Epoch ${runner.epochCount}: New milestone (${runner.milestoneCyclesBudget} cycles): ${runner.milestoneDescription.slice(0, 100)}...`, runner.id);
                broadcastEvent({ type: 'milestone', project: runner.id, title: runner.milestoneTitle, cycles: runner.milestoneCyclesBudget });
              } catch (e) {
                deps.log(`Failed to parse milestone: ${e.message}`, runner.id);
              }
            }
            // Check for PROJECT_COMPLETE tag
            const completeMatch = result.resultText.match(/<!-- PROJECT_COMPLETE -->\s*([\s\S]*?)\s*<!-- \/PROJECT_COMPLETE -->/);
            if (completeMatch) {
              try {
                const completion = JSON.parse(completeMatch[1]);
                const success = !!completion.success;
                const message = completion.message || 'Project completed';
                if (success) {
                  runner.setState({
                    phase: 'examination',
                    pendingCompletionMessage: message,
                    examinationFeedback: null,
                    completionSuccess: false,
                    completionMessage: null,
                    isComplete: false,
                    isPaused: false,
                    pauseReason: null,
                  });
                  deps.log(`🧪 PROJECT COMPLETE claimed — routing to Themis examination: ${message}`, runner.id);
                  broadcastEvent({ type: 'phase', project: runner.id, phase: 'examination', title: runner.milestoneTitle || 'Project examination' });
                } else {
                  runner.setState({
                    isComplete: true,
                    completionSuccess: success,
                    completionMessage: message,
                    isPaused: true,
                    pauseReason: `Project ${success ? 'completed successfully' : 'ended'}: ${message}`,
                  });
                  deps.log(`🏁 PROJECT COMPLETE (success: ${success}): ${message}`, runner.id);
                  broadcastEvent({ type: 'project-complete', project: runner.id, success, message });
                }
                continue;
              } catch (e) {
                deps.log(`Failed to parse PROJECT_COMPLETE: ${e.message}`, runner.id);
              }
            }

            // Check for STOP file
            if (fs.existsSync(runner.stopPath)) {
              deps.log(`STOP file detected — pausing project`, runner.id);
              runner.setState({ isPaused: true, pauseReason: 'Project stopped by Athena' });
              continue;
            }
          }

          // Execute schedule steps (delays + workers)
          if (schedule) {
            runner.currentSchedule = schedule;
            runner.saveState(); // Persist schedule before execution so it survives reboot
            const { total, failures } = await runner.executeSchedule(schedule, config, 'athena');
            cycleTotal += total;
            cycleFailures += failures;
            runner.currentSchedule = null;
            runner.completedAgents = [];
          }

          runner.saveState();
        }
      }

      // ===== PHASE: IMPLEMENTATION (Ares + his workers) =====
      else if (runner.phase === 'implementation') {
        const aresGraceMode = runner.milestoneCyclesUsed >= runner.milestoneCyclesBudget;
        // Check if deadline missed (before running)
        if (aresGraceMode && runner.aresGraceCycleUsed) {
          const failureReason = `Implementation deadline missed after ${runner.milestoneCyclesUsed}/${runner.milestoneCyclesBudget} cycles for ${runner.currentMilestoneId || 'unknown milestone'}.`;
          await runner.decideEpochPR('closed', { actor: 'apollo', reason: failureReason });
          await runner.markCurrentMilestoneFailed(failureReason);
          deps.log(`⏰ Implementation deadline missed (${runner.milestoneCyclesUsed}/${runner.milestoneCyclesBudget} cycles)`, runner.id);
          runner.setState({ currentEpochId: null, currentEpochPrId: null, currentMilestoneBranch: null, aresGraceCycleUsed: false, phase: 'athena' });
          continue;
        }

        // Resume interrupted schedule from previous cycle (e.g. after reboot)
        // Note: don't require completedAgents — schedule may start with a delay step
        if (runner.currentSchedule) {
          deps.log(`Resuming interrupted schedule (${runner.completedAgents.length} agents already completed${runner.completedAgents.length ? ': [' + runner.completedAgents.join(', ') + ']' : ''})`, runner.id);
          const { total, failures } = await runner.executeSchedule(runner.currentSchedule, config, 'ares');
          cycleTotal += total;
          cycleFailures += failures;
          runner.currentSchedule = null;
          runner.completedAgents = [];
          runner.saveState();
        } else {

        const ares = managers.find(m => m.name === 'ares');
        if (ares) {
          let epochStateChanged = false;
          if (!runner.currentEpochId) {
            runner.currentEpochId = await runner.allocateNextEpochId();
            runner.epochCount += 1;
            epochStateChanged = true;
          }
          if (!runner.currentMilestoneBranch) {
            const branchPrefix = runner.makeMilestoneBranchPrefix(runner.currentMilestoneId);
            runner.currentMilestoneBranch = `${String(runner.currentEpochId || 'E0').toLowerCase()}-${branchPrefix}-${runner.slugifyMilestoneTitle(runner.milestoneTitle, { stripLeadingMilestoneId: runner.currentMilestoneId })}`;
            epochStateChanged = true;
          }
          if (epochStateChanged) runner.saveState();
          const openEpochPr = await runner.ensureEpochPRForCurrentMilestone();
          // Build context for Ares (remaining includes this cycle)
          const cyclesRemaining = Math.max(0, runner.milestoneCyclesBudget - runner.milestoneCyclesUsed);
          let aresContext = `> **Milestone ID:** ${runner.currentMilestoneId || 'unknown'}
> **Milestone:** ${runner.milestoneDescription}
> **Epoch ID:** ${runner.currentEpochId || 'unknown'}
> **Cycles remaining:** ${cyclesRemaining} of ${runner.milestoneCyclesBudget}
> **Milestone branch:** ${runner.currentMilestoneBranch || 'not set'}
> **Epoch PR:** ${openEpochPr?.id ? `#${openEpochPr.id}` : 'not set'}
> **Epoch PR rule:** The orchestrator assigned exactly one TBC PR to this milestone branch. Use it instead of creating competing PRs.

`;
          if (aresGraceMode) {
            aresContext += `> **Grace review mode:** Worker budget is exhausted. This is your final manager-only pass.
> **Do not emit a schedule. Do not assign any workers.**
> Review the existing evidence only. If the milestone is already complete, emit <!-- CLAIM_COMPLETE -->. Otherwise emit no completion block and the milestone will fail.

`;
          }
          if (runner.isFixRound && runner.verificationFeedback) {
            aresContext += `> **Legacy verification feedback:**
> ${runner.verificationFeedback}

`;
          }

          const result = await runner.runAgent(ares, config, null, aresContext);
          cycleTotal++;
          if (!result || !result.success) cycleFailures++;
          if (aresGraceMode) runner.aresGraceCycleUsed = true;

          // Parse schedule and check for CLAIM_COMPLETE
          let schedule = null;
          let claimedComplete = false;
          if (result && result.resultText) {
            if (!aresGraceMode) {
              schedule = runner.parseSchedule(result.resultText);
              if (schedule) {
                deps.log(`Schedule: ${JSON.stringify(schedule)}`, runner.id);
                runner.currentSchedule = schedule;
              }
            } else if (runner.parseSchedule(result.resultText)) {
              deps.log('⚠️ Ignoring Ares schedule because grace review mode forbids worker scheduling', runner.id);
            }

            // Check if Ares claims milestone complete
            if (result.resultText.includes('<!-- CLAIM_COMPLETE -->')) {
              claimedComplete = true;
              const openEpochPr = await runner.ensureEpochPRForCurrentMilestone();
              if (!openEpochPr) {
                runner.verificationFeedback = `Ares claimed milestone completion without an orchestrator-managed epoch PR on branch ${runner.currentMilestoneBranch || 'unknown'}.`;
                deps.log('⚠️ CLAIM_COMPLETE ignored because no orchestrator-managed epoch PR exists for the current milestone branch', runner.id);
                runner.saveState();
                claimedComplete = false;
              } else {
                deps.log(`🎯 Ares claims milestone complete for epoch PR #${openEpochPr.id} — switching to verification`, runner.id);
                runner.setState({ phase: 'verification', currentEpochPrId: openEpochPr.id });
                broadcastEvent({ type: 'phase', project: runner.id, phase: 'verification', title: runner.milestoneTitle });
              }
            }
          }

          if (aresGraceMode && !claimedComplete) {
            const failureReason = `Implementation deadline missed after ${runner.milestoneCyclesUsed}/${runner.milestoneCyclesBudget} cycles for ${runner.currentMilestoneId || 'unknown milestone'} (Ares grace review did not claim completion).`;
            await runner.decideEpochPR('closed', { actor: 'apollo', reason: failureReason });
            await runner.markCurrentMilestoneFailed(failureReason);
            deps.log(`⏰ ${failureReason}`, runner.id);
            runner.setState({ currentEpochId: null, currentEpochPrId: null, currentMilestoneBranch: null, aresGraceCycleUsed: false, phase: 'athena', verificationFeedback: failureReason });
            runner.saveState();
            continue;
          }

          // Execute schedule steps (delays + workers)
          if (schedule) {
            runner.completedAgents = [];
            runner.saveState(); // Persist schedule before execution so it survives reboot
            const { total, failures } = await runner.executeSchedule(schedule, config, 'ares');
            cycleTotal += total;
            cycleFailures += failures;
            runner.currentSchedule = null;
            runner.completedAgents = [];
            runner.saveState();
          }
        }
        } // end else (no interrupted schedule)
        // Only count cycle if at least one agent succeeded
        if (cycleTotal > 0 && cycleFailures < cycleTotal) {
          runner.milestoneCyclesUsed++;
        } else if (cycleTotal > 0) {
          deps.log(`All ${cycleTotal} agents failed — cycle not counted toward milestone budget`, runner.id);
        }
        runner.saveState();
      }

      // ===== PHASE: VERIFICATION (Apollo + his workers) =====
      else if (runner.phase === 'verification') {
        // Resume interrupted verification schedule (e.g. after reboot)
        if (runner.currentSchedule && runner.completedAgents.length > 0) {
          deps.log(`Resuming interrupted verification schedule (${runner.completedAgents.length} agents already completed: [${runner.completedAgents.join(', ')}])`, runner.id);
          const { total, failures } = await runner.executeSchedule(runner.currentSchedule, config, 'apollo');
          cycleTotal += total;
          cycleFailures += failures;
          runner.currentSchedule = null;
          runner.completedAgents = [];
          runner.saveState();
        } else {
        const apollo = managers.find(m => m.name === 'apollo');
        if (apollo) {
          const isRollupVerification = !runner.currentEpochPrId;
          const apolloContext = isRollupVerification
            ? `> **Milestone to verify:** ${runner.milestoneDescription}\n> **Rollup verification target:** ${runner.currentMilestoneId || 'unknown'}\n> **Verification mode:** Parent milestone rollup after a child milestone passed\n> **Active epoch PR:** none (rollup verification)\n> Apollo should decide whether this parent milestone is now fully complete or Athena should plan the next child under it.\n\n`
            : `> **Milestone to verify:** ${runner.milestoneDescription}\n> **Milestone branch:** ${runner.currentMilestoneBranch || 'not set'}\n> **Active epoch PR:** ${runner.currentEpochPrId || 'unknown'}\n> Apollo owns the PR decision: merge on pass, close on fail.\n\n`;

          const result = await runner.runAgent(apollo, config, null, apolloContext);
          cycleTotal++;
          if (!result || !result.success) cycleFailures++;

          let schedule = null;
          let decision = null;
          if (result && result.resultText) {
            schedule = runner.parseSchedule(result.resultText);
            if (schedule) {
              deps.log(`Schedule: ${JSON.stringify(schedule)}`, runner.id);
            }

            // Check for verification decision
            if (result.resultText.includes('<!-- VERIFY_PASS -->')) {
              decision = 'pass';
            }
            const failMatch = result.resultText.match(/<!-- VERIFY_FAIL -->\s*([\s\S]*?)\s*<!-- \/VERIFY_FAIL -->/);
            if (failMatch) {
              try {
                const failData = JSON.parse(failMatch[1]);
                decision = 'fail';
                runner.verificationFeedback = failData.feedback || 'Verification failed (no specific feedback)';
              } catch {
                decision = 'fail';
                runner.verificationFeedback = 'Verification failed (could not parse feedback)';
              }
            }
          }

          // Execute schedule steps (delays + workers)
          if (schedule) {
            runner.currentSchedule = schedule;
            runner.completedAgents = [];
            runner.saveState(); // Persist schedule before execution so it survives reboot
            const { total, failures } = await runner.executeSchedule(schedule, config, 'apollo');
            cycleTotal += total;
            cycleFailures += failures;
            runner.currentSchedule = null;
            runner.completedAgents = [];
            runner.saveState();
          }

          // Process decision
          if (decision === 'pass') {
            const mergedPr = isRollupVerification ? null : await runner.decideEpochPR('merged', {
              actor: 'apollo',
              reason: `Apollo passed milestone ${runner.currentMilestoneId || ''} ${runner.milestoneTitle || runner.milestoneDescription || ''}`.trim(),
            });
            const completedMilestoneId = runner.currentMilestoneId;
            const completedMilestoneTitle = runner.milestoneTitle;
            const parentMilestoneId = runner.getParentMilestoneId(completedMilestoneId);
            await runner.markCurrentMilestoneCompleted();
            if (parentMilestoneId) {
              const parentMilestone = await runner.getMilestoneRecord(parentMilestoneId);
              deps.log(`✅ Milestone verified — escalating completion check to parent milestone ${parentMilestoneId}`, runner.id);
              broadcastEvent({ type: 'verified', project: runner.id, title: completedMilestoneTitle });
              if (parentMilestone) {
                await runner.upsertMilestoneRecord({
                  milestoneId: parentMilestoneId,
                  title: parentMilestone.title,
                  description: parentMilestone.description,
                  cyclesBudget: parentMilestone.cycles_budget,
                  branchName: parentMilestone.branch_name,
                  parentMilestoneId: parentMilestone.parent_milestone_id,
                  phase: 'verification',
                  status: 'active',
                  linkedPrId: parentMilestone.linked_pr_id,
                  failureReason: null,
                });
              }
              runner.setState({
                milestoneTitle: parentMilestone?.title || parentMilestoneId,
                milestoneDescription: parentMilestone?.description || `Parent rollup verification for ${parentMilestoneId}`,
                milestoneCyclesBudget: parentMilestone?.cycles_budget || 0,
                milestoneCyclesUsed: parentMilestone?.cycles_used || 0,
                currentMilestoneId: parentMilestoneId,
                pendingMilestoneId: null,
                currentEpochId: null,
                currentEpochPrId: null,
                currentMilestoneBranch: parentMilestone?.branch_name || null,
                aresGraceCycleUsed: false,
                lastMergedMilestoneBranch: mergedPr?.branch_name || mergedPr?.head_branch || runner.currentMilestoneBranch || runner.lastMergedMilestoneBranch,
                verificationFeedback: null,
                isFixRound: false,
                phase: 'verification',
              });
              broadcastEvent({ type: 'phase', project: runner.id, phase: 'verification', title: parentMilestone?.title || parentMilestoneId });
            } else {
              deps.log(`✅ Milestone verified — waking Athena for next milestone`, runner.id);
              broadcastEvent({ type: 'verified', project: runner.id, title: runner.milestoneTitle });
              runner.milestoneTitle = null;
              runner.setState({
                milestoneTitle: null,
                milestoneDescription: null,
                milestoneCyclesBudget: 0,
                milestoneCyclesUsed: 0,
                currentMilestoneId: null,
                pendingMilestoneId: null,
                currentEpochId: null,
                currentEpochPrId: null,
                currentMilestoneBranch: null,
                aresGraceCycleUsed: false,
                lastMergedMilestoneBranch: mergedPr?.branch_name || mergedPr?.head_branch || runner.currentMilestoneBranch || runner.lastMergedMilestoneBranch,
                verificationFeedback: null,
                isFixRound: false,
                phase: 'athena',
              });
            }
          } else if (decision === 'fail') {
            const failureReason = runner.verificationFeedback || 'Apollo rejected the epoch PR and requested milestone splitting or narrowing.';
            if (isRollupVerification) {
              deps.log('❌ Parent rollup verification incomplete — returning to Athena to plan the next child milestone', runner.id);
              broadcastEvent({ type: 'verify-fail', project: runner.id, title: runner.milestoneTitle });
              runner.setState({
                pendingMilestoneId: null,
                currentEpochId: null,
                currentEpochPrId: null,
                currentMilestoneBranch: null,
                aresGraceCycleUsed: false,
                verificationFeedback: failureReason,
                isFixRound: false,
                phase: 'athena',
              });
            } else {
              await runner.decideEpochPR('closed', {
                actor: 'apollo',
                reason: failureReason,
              });
              await runner.markCurrentMilestoneFailed(failureReason);
              deps.log('❌ Verification failed — returning to Athena for split/replan', runner.id);
              broadcastEvent({ type: 'verify-fail', project: runner.id, title: runner.milestoneTitle });
              runner.setState({
                pendingMilestoneId: null,
                currentEpochId: null,
                currentEpochPrId: null,
                aresGraceCycleUsed: false,
                verificationFeedback: failureReason,
                isFixRound: false,
                phase: 'athena',
              });
            }
          } else {
            // No decision yet, stay in verification phase — still save
            runner.saveState();
          }
        }
        } // end else (no interrupted verification schedule)
      }

      // ===== PHASE: EXAMINATION (Themis final audit) =====
      else if (runner.phase === 'examination') {
        // Resume interrupted examination schedule (e.g. after reboot)
        if (runner.currentSchedule) {
          deps.log(`Resuming interrupted examination schedule (${runner.completedAgents.length} agents already completed${runner.completedAgents.length ? ': [' + runner.completedAgents.join(', ') + ']' : ''})`, runner.id);
          const { total, failures } = await runner.executeSchedule(runner.currentSchedule, config, 'themis');
          cycleTotal += total;
          cycleFailures += failures;
          runner.currentSchedule = null;
          runner.completedAgents = [];
          runner.saveState();
        } else {
        const themis = managers.find(m => m.name === 'themis');
        if (themis) {
          const themisContext = `> **Final completion claim:** ${runner.pendingCompletionMessage || 'Project claimed complete'}\n> **Evaluate the entire project, not just the human\'s explicit goal.** Audit correctness, completeness, maintainability, artifacts, tests, docs, and obvious risks.\n\n`;
          const result = await runner.runAgent(themis, config, null, themisContext, { mode: 'full', issues: [] });
          cycleTotal++;
          if (!result || !result.success) cycleFailures++;

          let schedule = null;
          let decision = null;
          let failData = null;
          if (result && result.resultText) {
            schedule = runner.parseSchedule(result.resultText);
            if (schedule) {
              deps.log(`Schedule: ${JSON.stringify(schedule)}`, runner.id);
            }

            if (result.resultText.includes('<!-- EXAM_PASS -->')) {
              decision = 'pass';
            }
            const failMatch = result.resultText.match(/<!-- EXAM_FAIL -->\s*([\s\S]*?)\s*<!-- \/EXAM_FAIL -->/);
            if (failMatch) {
              try {
                failData = JSON.parse(failMatch[1]);
              } catch {
                failData = { feedback: 'Themis rejected project completion, but the response could not be parsed.' };
              }
              decision = 'fail';
            } else if (!schedule && decision == null) {
              decision = 'fail';
            }
          }

          if (schedule) {
            runner.currentSchedule = schedule;
            runner.completedAgents = [];
            runner.saveState();
            const { total, failures } = await runner.executeSchedule(schedule, config, 'themis');
            cycleTotal += total;
            cycleFailures += failures;
            runner.currentSchedule = null;
            runner.completedAgents = [];
            runner.saveState();
          }

          if (decision === 'pass') {
            const message = runner.pendingCompletionMessage || 'Project completed';
            runner.setState({
              phase: 'athena',
              isComplete: true,
              completionSuccess: true,
              completionMessage: message,
              pendingCompletionMessage: null,
              examinationFeedback: null,
              currentSchedule: null,
              completedAgents: [],
              isPaused: true,
              pauseReason: `Project completed successfully: ${message}`,
            });
            deps.log(`🏁 PROJECT COMPLETE (validated by Themis): ${message}`, runner.id);
            broadcastEvent({ type: 'project-complete', project: runner.id, success: true, message });
          } else if (decision === 'fail') {
            let issues = Array.isArray(failData?.issues) ? failData.issues : [];
            const rawFeedback = (result?.resultText || '').trim();
            if (issues.length === 0) {
              issues = [{
                title: 'Themis rejected project completion',
                body: rawFeedback || failData?.feedback || failData?.summary || 'Themis did not issue EXAM_PASS, so the completion claim was rejected.',
              }];
            }
            const createdIssueIds = [];
            for (const issue of issues) {
              if (!issue?.title) continue;
              try {
                const created = await runner.createIssue(issue.title, issue.body || '', 'themis');
                createdIssueIds.push(created.issueId);
              } catch (e) {
                deps.log(`Themis issue creation failed: ${e.message}`, runner.id);
              }
            }
            const feedback = failData?.feedback || failData?.summary || rawFeedback || 'Themis rejected the project completion claim.';
            runner.setState({
              phase: 'athena',
              examinationFeedback: createdIssueIds.length
                ? `${feedback} New issues: ${createdIssueIds.map(id => `#${id}`).join(', ')}`
                : feedback,
              pendingCompletionMessage: null,
              currentSchedule: null,
              completedAgents: [],
              isComplete: false,
              completionSuccess: false,
              completionMessage: null,
              isPaused: false,
              pauseReason: null,
            });
            deps.log(`❌ Themis rejected project completion — returning to Athena`, runner.id);
            broadcastEvent({ type: 'phase', project: runner.id, phase: 'athena', title: runner.milestoneTitle || 'Replanning after Themis rejection' });
          } else {
            // No decision yet, stay in examination phase — still save
            runner.saveState();
          }
        }
        } // end else (no interrupted examination schedule)
      }

      // If no agent succeeded, don't count this cycle
      if (cycleTotal > 0 && cycleFailures === cycleTotal) {
        runner.cycleCount--;
        runner.saveState();
      }

      // Track consecutive agent failures — auto-pause after 10
      runner.consecutiveFailures = (cycleTotal > 0 && cycleFailures === cycleTotal)
        ? runner.consecutiveFailures + cycleFailures
        : 0;
      if (runner.consecutiveFailures >= 10 && runner.running) {
        deps.log(`⚠️ ${runner.consecutiveFailures} consecutive agent failures — auto-pausing (retry in 2h)`, runner.id);
        broadcastEvent({ type: 'error', project: runner.id, message: `${runner.consecutiveFailures} consecutive failures — auto-paused` });
        runner.setState({ isPaused: true, pauseReason: `${runner.consecutiveFailures} consecutive agent failures` });
        runner.consecutiveFailures = 0;
        await runner._autoPauseWait(2 * 60 * 60 * 1000);
        if (!runner.running) break;
        continue;
      }

      // Compute sleep: budget-derived or fixed interval
      const sleepMs = runner.computeSleepInterval();
      runner.lastComputedSleepMs = sleepMs; // Cache for status requests
      if (runner.running) {
        deps.log(`Sleeping ${Math.round(sleepMs / 1000)}s...`, runner.id);
        runner.wakeNow = false;
        runner.sleepUntil = Date.now() + sleepMs;

        let sleptMs = 0;
        while (sleptMs < sleepMs && !runner.wakeNow && runner.running) {
          await deps.sleep(5000);
          sleptMs += 5000;
          while (runner.isPaused && !runner.wakeNow && runner.running) {
            await deps.sleep(1000);
          }
        }
        runner.sleepUntil = null;
      }
    }
  }
