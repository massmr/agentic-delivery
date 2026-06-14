'use client';

import { useMemo, useState } from 'react';

import ConfigEditor from './config-editor';
import CollapsiblePanel from './collapsible-panel';
import RailwayMappingEditor from './railway-mapping-editor';

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

export default function InvocationShell({ summary, doctor, apiBase }) {
  const sections = useMemo(() => ([
    {
      id: 'workspace',
      label: 'Workspace',
      eyebrow: 'Workspace readiness',
      badge: summary.config?.parses ? 'Config parses' : 'Config attention',
      content: (
        <>
          <dl className="definition-grid">
            <dt>Config</dt>
            <dd>{summary.config?.path}</dd>
            <dt>Exists</dt>
            <dd>{value(summary.config?.exists)}</dd>
            <dt>Parses</dt>
            <dd>{value(summary.config?.parses)}</dd>
          </dl>
          {(summary.config?.issues ?? []).map((issue) => <p className="warning" key={issue}>{issue}</p>)}
          {summary.workspaceSettings ? (
            <section className="embedded-editor" aria-label="Safe setup controls">
              <h3>Safe setup controls</h3>
              <ConfigEditor apiBase={apiBase} settings={summary.workspaceSettings} />
            </section>
          ) : null}
        </>
      )
    },
    {
      id: 'repositories',
      label: 'Repositories',
      eyebrow: 'Controlled codebases',
      badge: `${(summary.repositories ?? []).length} total`,
      content: (
        <div className="list compact-list">
          {(summary.repositories ?? []).map((repo) => (
            <article key={repo.id} className="record-card">
              <h3>{repo.id}</h3>
              <p>{repo.path}</p>
              <p>Default branch: {repo.defaultBranch}</p>
              <p>Railway staging: {repo.stagingDeployment?.status ?? 'not mapped'}</p>
            </article>
          ))}
        </div>
      )
    },
    {
      id: 'railway-mapping',
      label: 'Railway mapping',
      eyebrow: 'Staging verification',
      badge: 'Mappings',
      content: (
        <>
          <p className="help-text">Map each controlled repository to staging. Use manual Railway IDs for Railway verification, or choose github_only/none when staging should not require Railway IDs.</p>
          <RailwayMappingEditor apiBase={apiBase} repositories={summary.repositories ?? []} />
        </>
      )
    },
    {
      id: 'doctor',
      label: 'Doctor',
      eyebrow: 'Readiness probe',
      badge: doctor.ok ? 'Ready' : 'Needs attention',
      content: (
        <ul className="check-list">
          {(doctor.checks ?? []).map((check) => (
            <li key={`${check.label}-${check.message}`}>
              <span>{check.status}</span>
              <p>{check.label}</p>
            </li>
          ))}
        </ul>
      )
    },
    {
      id: 'providers',
      label: 'Providers',
      eyebrow: 'Provider modes',
      badge: `${Object.keys(summary.providers ?? {}).length} modes`,
      content: (
        <div className="cards">
          {Object.entries(summary.providers ?? {}).map(([name, provider]) => (
            <article key={name} className="record-card">
              <h3>{name}</h3>
              <table><tbody>{rows(provider)}</tbody></table>
            </article>
          ))}
        </div>
      )
    },
    {
      id: 'delivery-policy',
      label: 'Delivery policy',
      eyebrow: 'Guardrails',
      badge: 'Policy',
      content: (
        <div className="cards">
          <article className="record-card">
            <h3>Checks</h3>
            <p>No remote checks: {summary.deliveryPolicy?.noRemoteChecks ?? 'not configured'}</p>
          </article>
          {['develop', 'main'].map((target) => (
            <article key={target} className="record-card">
              <h3>{target}</h3>
              <table><tbody>{rows(summary.deliveryPolicy?.[target])}</tbody></table>
            </article>
          ))}
        </div>
      )
    },
    {
      id: 'mcp-servers',
      label: 'MCP servers',
      eyebrow: 'Tool boundary',
      badge: `${(summary.mcpServers ?? []).length} servers`,
      content: (
        <div className="list compact-list">
          {(summary.mcpServers ?? []).map((server) => (
            <article key={server.id} className="record-card">
              <h3>{server.id}</h3>
              <p>{server.transport}</p>
              <p>Providers: {value(server.configuredProviders)}</p>
              <p>Env names: {value(server.envVarNames)}</p>
            </article>
          ))}
        </div>
      )
    },
    {
      id: 'runs',
      label: 'Runs and reports',
      eyebrow: 'Execution evidence',
      badge: `${(summary.runs ?? []).length} recorded`,
      content: (
        <div className="run-strip">
          {(summary.runs ?? []).map((run) => (
            <article key={run.runId} className="run-card">
              <header>
                <h3>{run.ticketKey} / {run.runId}</h3>
                <p>{run.state} | {run.updatedAt}</p>
              </header>
              <ul>
                {run.reports.map((report) => (
                  <li key={report.id}>{report.label}: {report.exists ? report.path : 'not found'}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      )
    }
  ]), [summary, doctor, apiBase]);

  const [activeSectionId, setActiveSectionId] = useState(sections[0]?.id ?? 'workspace');
  const activeSection = sections.find((section) => section.id === activeSectionId) ?? sections[0];

  return (
    <section className="shell-layout" aria-label="Invocation workspace">
      <aside className="sidebar" aria-label="Console navigation">
        <section className="panel nav-panel">
          <h2>Control map</h2>
          <nav>
            {sections.map((section) => (
              <button
                key={section.id}
                aria-pressed={activeSection?.id === section.id}
                className={`nav-item${activeSection?.id === section.id ? ' active' : ''}`}
                onClick={() => setActiveSectionId(section.id)}
                type="button"
              >
                {section.label}
              </button>
            ))}
          </nav>
        </section>

        <section className="panel system-snapshot">
          <h2>Snapshot</h2>
          <dl>
            <dt>Config</dt>
            <dd>{summary.config?.path}</dd>
            <dt>Config exists</dt>
            <dd>{value(summary.config?.exists)}</dd>
            <dt>Config parses</dt>
            <dd>{value(summary.config?.parses)}</dd>
            <dt>MCP servers</dt>
            <dd>{(summary.mcpServers ?? []).length}</dd>
          </dl>
        </section>
      </aside>

      <div className="shell-main">
        {activeSection ? (
          <CollapsiblePanel
            badge={activeSection.badge}
            defaultOpen
            eyebrow={activeSection.eyebrow}
            id={activeSection.id}
            title={activeSection.label}
          >
            {activeSection.content}
          </CollapsiblePanel>
        ) : null}
      </div>
    </section>
  );
}
