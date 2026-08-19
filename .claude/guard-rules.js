// Blocks irreversible commands from running without a human in the loop.
// Claude Code passes hook input as JSON on stdin; exit 2 blocks the tool call.
//
// Place at .claude/guard-rules.js and reference from .claude/settings.json.

let input = '';
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  let cmd = '';
  try {
    cmd = (JSON.parse(input).tool_input || {}).command || '';
  } catch {
    process.exit(0); // Unparseable input is not grounds to block.
  }

  const blocked = [
    [/git\s+push\s+.*--force|git\s+push\s+.*-f\b/, 'Force push rewrites history. Run it yourself if you mean it.'],
    [/git\s+reset\s+--hard/, 'Hard reset discards uncommitted work. Run it yourself.'],
    [/git\s+checkout\s+\.\s*$/, 'This discards all uncommitted changes. Run it yourself.'],
    [/firebase\s+deploy(?!.*--dry-run)/, 'Deploys to the live project. Ahmed deploys, not the agent. Use --dry-run to compile-check.'],
    [/firebase\s+firestore:delete/, 'Deletes live Firestore data. Never run this from an agent.'],
    [/rm\s+-rf/, 'Recursive delete. Run it yourself if you mean it.'],
  ];

  for (const [pattern, reason] of blocked) {
    if (pattern.test(cmd)) {
      console.error(`BLOCKED: ${reason}\nCommand: ${cmd}`);
      process.exit(2);
    }
  }
  process.exit(0);
});
