'use client';

import { useState } from 'react';

const verificationModes = ['railway_mcp', 'github_only', 'none'];

function getVerificationMode(stagingDeployment) {
  const verification = stagingDeployment?.verification;
  const mode = typeof verification === 'string' ? verification : verification?.mode;
  return verificationModes.includes(mode) ? mode : 'railway_mcp';
}

function getSmokeUrls(stagingDeployment) {
  const verification = stagingDeployment?.verification;
  if (!verification || typeof verification === 'string') return [];
  return Array.isArray(verification.smokeUrls) ? verification.smokeUrls : [];
}

function toForm(repo) {
  const staging = repo.stagingDeployment ?? {};

  return {
    mode: getVerificationMode(staging),
    projectId: staging.projectId ?? '',
    environmentId: staging.environmentId ?? '',
    serviceId: staging.serviceId ?? '',
    branch: staging.branch ?? repo.defaultBranch ?? 'develop',
    smokeUrls: getSmokeUrls(staging)
  };
}

function doctorChecksForRepo(doctor, repoId) {
  const checks = doctor?.checks ?? [];
  const repoChecks = checks.filter((check) => check.label === `Deployment ${repoId}`);
  return repoChecks.length ? repoChecks : checks;
}

function feedbackMessage(body, response) {
  if (body?.error) return body.error;
  if (body?.message) return body.message;
  return `Save failed with HTTP ${response.status}.`;
}

function serviceLabel(service) {
  const project = service.projectName ?? service.projectId ?? 'unknown project';
  const environment = service.environmentName ?? service.environmentId ?? 'unknown environment';
  const branch = service.branch ? ` (${service.branch})` : '';
  return `${project} / ${service.name} / ${environment}${branch}`;
}

function selectServicePatch(service) {
  return {
    projectId: service.projectId ?? '',
    environmentId: service.environmentId ?? '',
    serviceId: service.id ?? '',
    ...(service.branch ? { branch: service.branch } : {})
  };
}

export default function RailwayMappingEditor({ apiBase, repositories }) {
  const [repoItems, setRepoItems] = useState(repositories ?? []);
  const [forms, setForms] = useState(() => Object.fromEntries((repositories ?? []).map((repo) => [repo.id, toForm(repo)])));
  const [savingRepo, setSavingRepo] = useState(null);
  const [feedback, setFeedback] = useState({});
  const [discovery, setDiscovery] = useState(null);
  const [discoveryFeedback, setDiscoveryFeedback] = useState(null);
  const [refreshingDiscovery, setRefreshingDiscovery] = useState(false);

  function updateForm(repoId, patch) {
    setForms((current) => ({
      ...current,
      [repoId]: { ...current[repoId], ...patch }
    }));
  }

  function updateRepoMapping(repoId, staging) {
    setRepoItems((current) => current.map((repo) => (
      repo.id === repoId ? { ...repo, stagingDeployment: staging } : repo
    )));
  }

  async function refreshDiscovery() {
    setRefreshingDiscovery(true);
    setDiscoveryFeedback(null);

    try {
      if (!apiBase) {
        throw new Error('Workspace API is not configured for this UI session.');
      }

      const response = await fetch(`${apiBase}/api/railway/discovery`);
      const body = await response.json();

      if (!response.ok) {
        throw new Error(feedbackMessage(body, response));
      }

      setDiscovery(body);
      setDiscoveryFeedback({
        kind: body.available ? 'ok' : 'warning',
        message: body.available
          ? `Loaded ${body.services?.length ?? 0} Railway service(s).`
          : body.message ?? 'Railway discovery is not available for this UI session.'
      });
    } catch (error) {
      setDiscoveryFeedback({ kind: 'warning', message: error instanceof Error ? error.message : String(error) });
    } finally {
      setRefreshingDiscovery(false);
    }
  }

  async function saveMapping(event, repo) {
    event.preventDefault();
    setSavingRepo(repo.id);
    setFeedback((current) => ({ ...current, [repo.id]: null }));

    try {
      if (!apiBase) {
        throw new Error('Workspace API is not configured for this UI session.');
      }

      const form = forms[repo.id] ?? toForm(repo);
      const needsRailwayIds = form.mode === 'railway_mcp';
      const body = {
        provider: 'railway',
        branch: form.branch || repo.defaultBranch || 'develop',
        verification: { mode: form.mode, smoke_urls: [] }
      };

      if (needsRailwayIds) {
        body.project_id = form.projectId;
        body.environment_id = form.environmentId;
        body.service_id = form.serviceId;
      }

      const response = await fetch(`${apiBase}/api/repositories/${encodeURIComponent(repo.id)}/deployments/staging`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      const responseBody = await response.json();
      const mapping = responseBody?.mapping?.staging;

      if (response.ok && mapping) {
        updateRepoMapping(repo.id, mapping);
        updateForm(repo.id, toForm({ ...repo, stagingDeployment: mapping }));
      }

      setFeedback((current) => ({
        ...current,
        [repo.id]: {
          kind: response.ok ? 'ok' : 'warning',
          message: response.ok ? 'Staging mapping saved.' : feedbackMessage(responseBody, response),
          config: responseBody?.config,
          doctor: responseBody?.doctor
        }
      }));
    } catch (error) {
      setFeedback((current) => ({
        ...current,
        [repo.id]: { kind: 'warning', message: error instanceof Error ? error.message : String(error) }
      }));
    } finally {
      setSavingRepo(null);
    }
  }

  return (
    <div className="list railway-mapping-editor">
      <div className="discovery-panel">
        <div>
          <p className="help-text">Read-only Railway discovery</p>
          <p>Load discovered projects and services, then use them to fill staging IDs. Manual entry remains available.</p>
        </div>
        <button disabled={refreshingDiscovery || !apiBase} onClick={refreshDiscovery} type="button">
          {refreshingDiscovery ? 'Refreshing...' : 'Refresh Railway discovery'}
        </button>
        {discoveryFeedback ? <p className={discoveryFeedback.kind}>{discoveryFeedback.message}</p> : null}
      </div>

      {repoItems.map((repo) => {
        const form = forms[repo.id] ?? toForm(repo);
        const needsRailwayIds = form.mode === 'railway_mcp';
        const repoFeedback = feedback[repo.id];
        const checks = doctorChecksForRepo(repoFeedback?.doctor, repo.id);
        const currentMode = repo.stagingDeployment?.verification?.mode ?? repo.stagingDeployment?.verification ?? 'not mapped';
        const discoveredServices = discovery?.available ? discovery.services ?? [] : [];

        return (
          <article key={repo.id}>
            <div className="repo-heading">
              <div>
                <h3>{repo.id}</h3>
                <p>{repo.path}</p>
              </div>
              <span>{repo.stagingDeployment?.status ?? 'not mapped'}</span>
            </div>

            <dl className="repo-meta">
              <dt>Default branch</dt>
              <dd>{repo.defaultBranch}</dd>
              <dt>Current verification</dt>
              <dd>{currentMode}</dd>
            </dl>

            <form className="config-editor mapping-form" onSubmit={(event) => saveMapping(event, repo)}>
              <div className="field">
                <label htmlFor={`${repo.id}-mode`}>Staging verification mode</label>
                <select
                  id={`${repo.id}-mode`}
                  value={form.mode}
                  onChange={(event) => updateForm(repo.id, { mode: event.target.value })}
                >
                  <option value="railway_mcp">railway_mcp</option>
                  <option value="github_only">github_only</option>
                  <option value="none">none</option>
                </select>
              </div>

              <div className="field">
                <label htmlFor={`${repo.id}-branch`}>Staging branch</label>
                <input
                  id={`${repo.id}-branch`}
                  value={form.branch}
                  onChange={(event) => updateForm(repo.id, { branch: event.target.value })}
                />
              </div>

              {needsRailwayIds ? (
                <div className="manual-railway-ids">
                  {discoveredServices.length ? (
                    <div className="field">
                      <label htmlFor={`${repo.id}-discovered-service`}>Discovered Railway service</label>
                      <select
                        id={`${repo.id}-discovered-service`}
                        value=""
                        onChange={(event) => {
                          const service = discoveredServices.find((candidate) => candidate.id === event.target.value);
                          if (service) updateForm(repo.id, selectServicePatch(service));
                        }}
                      >
                        <option value="">Select discovered service</option>
                        {discoveredServices.map((service) => (
                          <option key={`${service.projectId ?? 'project'}-${service.environmentId ?? 'environment'}-${service.id}`} value={service.id}>
                            {serviceLabel(service)}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                  <p className="help-text">Manual Railway IDs</p>
                  <div className="field">
                    <label htmlFor={`${repo.id}-project`}>Project ID</label>
                    <input
                      id={`${repo.id}-project`}
                      value={form.projectId}
                      onChange={(event) => updateForm(repo.id, { projectId: event.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`${repo.id}-environment`}>Environment ID</label>
                    <input
                      id={`${repo.id}-environment`}
                      value={form.environmentId}
                      onChange={(event) => updateForm(repo.id, { environmentId: event.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`${repo.id}-service`}>Service ID</label>
                    <input
                      id={`${repo.id}-service`}
                      value={form.serviceId}
                      onChange={(event) => updateForm(repo.id, { serviceId: event.target.value })}
                    />
                  </div>
                </div>
              ) : (
                <p className="help-text">Railway IDs are not required for this mode. Save writes only branch and verification choice.</p>
              )}

              <button disabled={savingRepo === repo.id || !apiBase} type="submit">
                {savingRepo === repo.id ? 'Saving...' : 'Save staging mapping'}
              </button>

              {repoFeedback ? (
                <div className="validation-feedback">
                  <p className={repoFeedback.kind}>{repoFeedback.message}</p>
                  <p className="help-text">Validation feedback</p>
                  {repoFeedback.config ? (
                    <p className="help-text">Config parses: {repoFeedback.config.parses ? 'yes' : 'no'}</p>
                  ) : null}
                  {repoFeedback.config?.issues?.length ? (
                    <ul>
                      {repoFeedback.config.issues.map((issue) => <li key={issue}>{issue}</li>)}
                    </ul>
                  ) : null}
                  {checks.length ? (
                    <ul>
                      {checks.map((check) => (
                        <li key={`${check.status}-${check.label}-${check.message}`}>
                          {check.status}: {check.label} - {check.message}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </form>
          </article>
        );
      })}
    </div>
  );
}
