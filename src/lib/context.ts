import { readRecentLogs } from "./log";
import { agentGet } from "./agentStore";
import { listTasks } from "./taskStore";

export function assembleLongContext(maxChars = 60000) {
  const sess = agentGet();
  const tasks = listTasks();
  const logs = readRecentLogs(300);
  const ctx = {
    session: sess,
    tasks,
    recent_logs: logs.map((l) => {
      try { return JSON.parse(l); } catch { return l; }
    }),
  };
  let text = JSON.stringify(ctx);
  if (text.length > maxChars) {
    // Drop logs first, then trim tasks
    const shallow = { session: sess, tasks: tasks.slice(-10) };
    text = JSON.stringify(shallow).slice(0, maxChars);
  }
  return text;
}
