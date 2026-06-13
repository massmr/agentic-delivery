'use client';

import { useState } from 'react';

export default function ConfigEditor({ apiBase, settings }) {
  const [workspaceName, setWorkspaceName] = useState(settings?.name ?? '');
  const [autonomy, setAutonomy] = useState(settings?.autonomy ?? 'supervised');
  const [maxConcurrentTickets, setMaxConcurrentTickets] = useState(String(settings?.maxConcurrentTickets ?? 1));
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setStatus(null);

    try {
      if (!apiBase) {
        throw new Error('Workspace API is not configured for this UI session.');
      }

      const response = await fetch(`${apiBase}/api/config`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceName,
          autonomy,
          maxConcurrentTickets: Number(maxConcurrentTickets)
        })
      });
      const body = await response.json();

      if (!response.ok || body.error) {
        throw new Error(body.error ?? 'Config update failed.');
      }

      setStatus({ kind: 'ok', message: 'Workspace config updated. Refresh to reload the summary.' });
    } catch (error) {
      setStatus({ kind: 'warning', message: error instanceof Error ? error.message : String(error) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="config-editor" onSubmit={onSubmit}>
      <div className="field">
        <label htmlFor="workspace-name">Workspace name</label>
        <input id="workspace-name" value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} />
      </div>

      <div className="field">
        <label htmlFor="workspace-autonomy">Autonomy</label>
        <select id="workspace-autonomy" value={autonomy} onChange={(event) => setAutonomy(event.target.value)}>
          <option value="supervised">supervised</option>
          <option value="autonomous">autonomous</option>
        </select>
      </div>

      <div className="field">
        <label htmlFor="workspace-max-concurrent">Max concurrent tickets</label>
        <input
          id="workspace-max-concurrent"
          min="1"
          type="number"
          value={maxConcurrentTickets}
          onChange={(event) => setMaxConcurrentTickets(event.target.value)}
        />
      </div>

      <button disabled={saving || !apiBase} type="submit">{saving ? 'Saving...' : 'Save safe config fields'}</button>
      <p className="help-text">Only workspace name, autonomy, and ticket concurrency are editable here. Secrets and provider controls stay out of the UI.</p>
      {status ? <p className={status.kind}>{status.message}</p> : null}
    </form>
  );
}
