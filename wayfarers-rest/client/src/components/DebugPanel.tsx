import { useState } from 'react';
import { FlavorCacheSection } from './dock/FlavorCacheSection.tsx';
import { PendingArrivalsSection } from './dock/PendingArrivalsSection.tsx';
import { RecentEventsSection } from './dock/RecentEventsSection.tsx';
import { RumorsSection } from './dock/RumorsSection.tsx';
import { SpriteGallerySection } from './dock/SpriteGallerySection.tsx';
import { ThreadsSection } from './dock/ThreadsSection.tsx';
import { WorldTagsSection } from './dock/WorldTagsSection.tsx';
import { ZonesSection } from './dock/ZonesSection.tsx';

/**
 * Compatibility shim — the original monolithic debug panel has been split
 * into per-section components under ./dock/. The next slice of the redesign
 * wires those sections into RightDock's Build (sprites + zones) and Inspector
 * (the rest) tabs. Until that lands, this component keeps the exact same
 * floating-right behavior and section order so tests + manual workflows
 * don't move underfoot.
 */
export function DebugPanel() {
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <button
        type="button"
        className="debug-toggle"
        onClick={() => setCollapsed(false)}
        data-testid="debug-toggle"
      >
        debug ▸
      </button>
    );
  }

  return (
    <aside className="debug-panel" data-testid="debug-panel">
      <header className="debug-panel-header">
        <span>debug</span>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          className="debug-panel-close"
          data-testid="debug-collapse"
        >
          ×
        </button>
      </header>

      <WorldTagsSection />
      <ThreadsSection />
      <PendingArrivalsSection />
      <FlavorCacheSection />
      <RumorsSection />
      <RecentEventsSection />
      <SpriteGallerySection />
      <ZonesSection />
    </aside>
  );
}
