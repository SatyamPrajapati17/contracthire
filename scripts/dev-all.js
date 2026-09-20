/* Single-command dev: runs the Next.js app AND the job worker together.
   Ctrl+C stops both. Usage: npm run dev */
const { spawn } = require("child_process");

const children = [];

function run(name, cmd, args, color) {
  const child = spawn(cmd, args, { shell: true, stdio: ["ignore", "pipe", "pipe"] });
  const tag = `\x1b[${color}m[${name}]\x1b[0m`;
  const forward = (buf) => {
    for (const line of buf.toString().split("\n")) {
      if (line.trim()) console.log(`${tag} ${line}`);
    }
  };
  child.stdout.on("data", forward);
  child.stderr.on("data", forward);
  child.on("exit", (code) => {
    console.log(`${tag} exited (${code})`);
    shutdown(code ?? 0);
  });
  children.push(child);
  return child;
}

function shutdown(code) {
  for (const c of children) {
    try { c.kill("SIGTERM"); } catch { /* already gone */ }
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

run("next", "npx", ["next", "dev", "-p", process.env.PORT || "3000"], "36");
run("worker", "npx", ["tsx", "worker/index.ts"], "33");
