import ConfigEditor from './config-editor';

async function fetchJson(path) {
  const base = process.env.EWOKBOT_UI_API_BASE;

  if (!base) {
    return { error: 'EWOKBOT_UI_API_BASE is not configured.' };
  }

  const response = await fetch(`${base}${path}`, { cache: 'no-store' });
  return response.json();
}

function value(value) {
  if (value === undefined || value === null || value === '') return 'not configured';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (Array.isArray(value)) return value.length === 0 ? 'none' : value.join(', ');
  return String(value);
}

function rows(record) {
  return Object.entries(record ?? {}).map(([key, item]) => (
    <tr key={key}>
      <th>{key}</th>
      <td>{value(item)}</td>
    </tr>
  ));
}

export default async function Page() {
  const [summary, doctor] = await Promise.all([
    fetchJson('/api/summary'),
    fetchJson('/api/doctor')
  ]);

  return (
    <main>
      <section className="hero">
        <p className="eyebrow">Local invocation</p>
        <h1>Ewokbot Invocation Control</h1>
        <p>{summary.workspaceRoot}</p>
      </section>

      <section className="grid">
        <article>
          <h2>Workspace</h2>
          <dl>
            <dt>Config</dt>
            <dd>{summary.config?.path}</dd>
            <dt>Exists</dt>
            <dd>{value(summary.config?.exists)}</dd>
            <dt>Parses</dt>
            <dd>{value(summary.config?.parses)}</dd>
          </dl>
          {(summary.config?.issues ?? []).map((issue) => <p className="warning" key={issue}>{issue}</p>)}
          {summary.workspaceSettings ? (
            <>
              <h3>Safe setup controls</h3>
              <ConfigEditor apiBase={process.env.EWOKBOT_UI_API_BASE ?? ''} settings={summary.workspaceSettings} />
            </>
          ) : null}
        </article>

        <article>
          <h2>Doctor</h2>
          <p className={doctor.ok ? 'ok' : 'warning'}>{doctor.ok ? 'Ready' : 'Needs attention'}</p>
          <ul>
            {(doctor.checks ?? []).slice(0, 8).map((check) => (
              <li key={`${check.label}-${check.message}`}>{check.status}: {check.label}</li>
            ))}
          </ul>
        </article>
      </section>

      <section>
        <h2>Providers</h2>
        <div className="cards">
          {Object.entries(summary.providers ?? {}).map(([name, provider]) => (
            <article key={name}>
              <h3>{name}</h3>
              <table><tbody>{rows(provider)}</tbody></table>
            </article>
          ))}
        </div>
      </section>

      <section>
        <h2>Delivery Policy</h2>
        <div className="cards">
          <article>
            <h3>Checks</h3>
            <p>No remote checks: {summary.deliveryPolicy?.noRemoteChecks ?? 'not configured'}</p>
          </article>
          {['develop', 'main'].map((target) => (
            <article key={target}>
              <h3>{target}</h3>
              <table><tbody>{rows(summary.deliveryPolicy?.[target])}</tbody></table>
            </article>
          ))}
        </div>
      </section>

      <section>
        <h2>Repositories</h2>
        <div className="list">
          {(summary.repositories ?? []).map((repo) => (
            <article key={repo.id}>
              <h3>{repo.id}</h3>
              <p>{repo.path}</p>
              <p>Default branch: {repo.defaultBranch}</p>
              <p>Railway staging: {repo.stagingDeployment?.status ?? 'not mapped'}</p>
            </article>
          ))}
        </div>
      </section>

      <section>
        <h2>MCP Servers</h2>
        <div className="list">
          {(summary.mcpServers ?? []).map((server) => (
            <article key={server.id}>
              <h3>{server.id}</h3>
              <p>{server.transport}</p>
              <p>Providers: {value(server.configuredProviders)}</p>
              <p>Env names: {value(server.envVarNames)}</p>
            </article>
          ))}
        </div>
      </section>

      <section>
        <h2>Runs</h2>
        <div className="list">
          {(summary.runs ?? []).map((run) => (
            <article key={run.runId}>
              <h3>{run.ticketKey} / {run.runId}</h3>
              <p>{run.state} · {run.updatedAt}</p>
              <ul>
                {run.reports.map((report) => (
                  <li key={report.id}>{report.label}: {report.exists ? report.path : 'not found'}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
