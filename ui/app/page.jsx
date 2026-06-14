import InvocationShell from './invocation-shell';

async function fetchJson(path) {
  const base = process.env.EWOKBOT_UI_API_BASE;

  if (!base) {
    return { error: 'EWOKBOT_UI_API_BASE is not configured.' };
  }

  const response = await fetch(`${base}${path}`, { cache: 'no-store' });
  return response.json();
}

export default async function Page() {
  const [summary, doctor] = await Promise.all([
    fetchJson('/api/summary'),
    fetchJson('/api/doctor')
  ]);

  return (
    <main className="operator-shell">
      <header className="topbar" aria-label="Invocation console status">
        <div className="topbar-title">
          <p className="eyebrow">Local invocation</p>
          <h1>Ewokbot Invocation Control</h1>
        </div>
        <p className="workspace-path" title={summary.workspaceRoot}>{summary.workspaceRoot}</p>
        <div className="topbar-status">
          <span className={doctor.ok ? 'status-pill ok' : 'status-pill warning'}>{doctor.ok ? 'Ready' : 'Needs attention'}</span>
          <span>{(summary.repositories ?? []).length} repos</span>
          <span>{(summary.runs ?? []).length} runs</span>
        </div>
      </header>
      <InvocationShell
        apiBase={process.env.EWOKBOT_UI_API_BASE ?? ''}
        doctor={doctor}
        summary={summary}
      />
    </main>
  );
}
