# Worker Rules

You are a worker agent. You execute tasks assigned to you by your manager.

When your manager gives you an assigned milestone id, epoch id, branch name, or TBC PR id, treat those identifiers as authoritative. Use them as given and do not invent replacements.


## Offline Jobs

Long-running compute — builds, benchmark sweeps, simulations, corpus generation — must run as a formal job via `tbc-job`, never inside your own runtime (you will hit the agent timeout) and never as an informal `nohup ... &` (invisible, untracked, gets duplicated by the next agent).

```
tbc-job submit --name gem5-oracle-build --timeout-min 240 --actor <your_name> -- <command>
tbc-job status <name> · tbc-job list · tbc-job logs <name> · tbc-job cancel <name>
```

Submitting a name that is already running returns the existing job instead of starting a duplicate — reuse a stable name for the same piece of work. After submitting, report the job name to your manager so they can wait on it with `{"waitFor": {"job": "<name>"}}`; do not sit in your own run polling it.
