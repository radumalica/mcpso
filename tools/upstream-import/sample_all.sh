#!/usr/bin/env bash
# Exploration helper: print a few samples from each interesting population.
D=/home/ubuntu/git/mcpso/.claude/worktrees/mcp-registry-audit
S="python3 -I $D/tools/upstream-import/sample.py $D/data/upstream-import"
echo "##### CSOAI-ORG"; $S author CSOAI-ORG 4
echo "##### Ryan-Clinton"; $S author Ryan-Clinton 3
echo "##### OTHER titles"; $S other x 10
echo "##### ADD titles"; $S add x 6
echo "##### CLOSED"; $S closed x 6
echo "##### BOT"; $S bot x 5
