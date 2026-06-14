'use client';

import { useState } from 'react';

export default function CollapsiblePanel({
  id,
  eyebrow,
  title,
  badge,
  defaultOpen = true,
  children
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="panel collapsible-panel" id={id}>
      <div className="section-heading panel-toggle-row">
        <div>
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <h2>{title}</h2>
        </div>
        <div className="panel-toggle-actions">
          {badge ? <span className="status-pill">{badge}</span> : null}
          <button
            aria-controls={`${id}-body`}
            aria-expanded={open}
            className="panel-toggle"
            onClick={() => setOpen((value) => !value)}
            type="button"
          >
            {open ? 'Reduce' : 'Expand'}
          </button>
        </div>
      </div>
      {open ? (
        <div className="panel-body" id={`${id}-body`}>
          {children}
        </div>
      ) : null}
    </section>
  );
}
