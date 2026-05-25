import { useEffect, useState, type ReactNode } from 'react';
import { useDispatch, useStore } from '../state/store.tsx';
import { EventTicker } from './EventTicker.tsx';
import { InterventionPicker } from './InterventionPicker.tsx';
import { SpriteGallerySection } from './dock/SpriteGallerySection.tsx';
import { ZonesSection } from './dock/ZonesSection.tsx';
import { WorldTagsSection } from './dock/WorldTagsSection.tsx';
import { ThreadsSection } from './dock/ThreadsSection.tsx';
import { PendingArrivalsSection } from './dock/PendingArrivalsSection.tsx';
import { FlavorCacheSection } from './dock/FlavorCacheSection.tsx';
import { RumorsSection } from './dock/RumorsSection.tsx';
import { RecentEventsSection } from './dock/RecentEventsSection.tsx';

type DockTab = 'events' | 'interventions' | 'build' | 'inspector';

const LS_TAB = 'wf.dock.tab';
const LS_COLLAPSED = 'wf.dock.collapsed';

/** Inspector tab is dev-only — gated by ?debug=1 in the URL or the
 *  `wf_debug=1` localStorage key. Checked once at render; flipping the gate
 *  requires a reload, which keeps the tab strip stable mid-session. */
function inspectorEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('debug') === '1') return true;
    return window.localStorage.getItem('wf_debug') === '1';
  } catch {
    return false;
  }
}

interface TabSpec {
  id: DockTab;
  label: string;
  icon: string;
  badge?: number;
  /** When set, the tab is shown but rendered with a "needs setup" affordance. */
  disabled?: boolean;
  render: () => ReactNode;
}

/**
 * Single docked right sidebar that hosts every right-side surface — the live
 * event ticker, the intervention picker, the player-facing Build tools
 * (sprite gallery, zone editor), and a gated Inspector for raw simulation
 * state. Replaces the four independently floating panels (EventTicker,
 * InterventionPicker, FavorIndicator, DebugPanel) with one column the
 * tavern grid never overlaps.
 *
 * Tab selection and collapse state persist to localStorage so reloads land
 * the keeper where they left off. The Interventions tab auto-activates when
 * the picker is opened from elsewhere (e.g. the favor chip in the status
 * strip) so the user never has to hunt for it.
 */
export function RightDock() {
  const dispatch = useDispatch();
  const { interventionPickerOpen, tickerEntries } = useStore();
  const inspector = inspectorEnabled();

  const [activeTab, setActiveTab] = useState<DockTab>(() => {
    try {
      const saved = window.localStorage.getItem(LS_TAB);
      if (saved === 'events' || saved === 'interventions' || saved === 'build' || saved === 'inspector') {
        if (saved === 'inspector' && !inspector) return 'events';
        return saved;
      }
    } catch {
      // ignore
    }
    return 'events';
  });
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(LS_COLLAPSED) === '1';
    } catch {
      return false;
    }
  });
  // Track which tab was last "seen" so the events tab can show an unread
  // count without re-rendering on every ticker push.
  const [lastSeenEventId, setLastSeenEventId] = useState<number>(() => {
    const newest = tickerEntries[0]?.eventId ?? 0;
    return newest;
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(LS_TAB, activeTab);
    } catch {
      // ignore
    }
    if (activeTab === 'events') {
      const newest = tickerEntries[0]?.eventId ?? 0;
      setLastSeenEventId(newest);
    }
  }, [activeTab, tickerEntries]);

  useEffect(() => {
    try {
      window.localStorage.setItem(LS_COLLAPSED, collapsed ? '1' : '0');
    } catch {
      // ignore
    }
  }, [collapsed]);

  // Auto-switch to Interventions when the picker is opened externally
  // (the favor chip in the status strip dispatches INTERVENTION_PICKER_OPENED).
  useEffect(() => {
    if (interventionPickerOpen) {
      setActiveTab('interventions');
      if (collapsed) setCollapsed(false);
    }
  }, [interventionPickerOpen, collapsed]);

  const unreadEvents = tickerEntries.filter(
    (e) => e.eventId > lastSeenEventId,
  ).length;

  const tabs: TabSpec[] = [
    {
      id: 'events',
      label: 'Events',
      icon: '📜',
      badge: activeTab === 'events' ? undefined : unreadEvents || undefined,
      render: () => (
        <div className="dock-body dock-body--ticker">
          <EventTicker />
        </div>
      ),
    },
    {
      id: 'interventions',
      label: 'Favors',
      icon: '⚡',
      render: () => (
        <div className="dock-body dock-body--interventions">
          {interventionPickerOpen ? (
            <InterventionPicker />
          ) : (
            <div className="dock-empty">
              <p>The favor picker opens when you spend one — tap the ⚡ chip in the status strip.</p>
              <button
                type="button"
                className="dock-empty-cta"
                onClick={() => dispatch({ type: 'INTERVENTION_PICKER_OPENED' })}
              >
                Open favor picker
              </button>
            </div>
          )}
        </div>
      ),
    },
    {
      id: 'build',
      label: 'Build',
      icon: '🛠',
      render: () => (
        <div className="dock-body dock-body--build">
          <SpriteGallerySection />
          <ZonesSection />
        </div>
      ),
    },
  ];
  if (inspector) {
    tabs.push({
      id: 'inspector',
      label: 'Inspector',
      icon: '🔬',
      render: () => (
        <div className="dock-body dock-body--inspector">
          <WorldTagsSection />
          <ThreadsSection />
          <PendingArrivalsSection />
          <FlavorCacheSection />
          <RumorsSection />
          <RecentEventsSection />
        </div>
      ),
    });
  }

  const active = tabs.find((t) => t.id === activeTab) ?? tabs[0];

  if (collapsed) {
    return (
      <aside className="right-dock right-dock--collapsed" data-testid="right-dock">
        <button
          type="button"
          className="dock-collapse-toggle"
          onClick={() => setCollapsed(false)}
          aria-label="Expand panel"
          title="Expand panel"
        >
          ◂
        </button>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`dock-rail-tab${t.id === activeTab ? ' is-active' : ''}`}
            onClick={() => {
              setActiveTab(t.id);
              setCollapsed(false);
            }}
            title={t.label}
            aria-label={t.label}
          >
            <span className="dock-rail-icon" aria-hidden>{t.icon}</span>
            {t.badge ? <span className="dock-tab-badge">{t.badge}</span> : null}
          </button>
        ))}
      </aside>
    );
  }

  return (
    <aside className="right-dock" data-testid="right-dock">
      <div className="dock-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === activeTab}
            className={`dock-tab${t.id === activeTab ? ' is-active' : ''}`}
            onClick={() => setActiveTab(t.id)}
            data-testid={`dock-tab-${t.id}`}
          >
            <span className="dock-tab-icon" aria-hidden>{t.icon}</span>
            <span className="dock-tab-label">{t.label}</span>
            {t.badge ? <span className="dock-tab-badge">{t.badge}</span> : null}
          </button>
        ))}
        <button
          type="button"
          className="dock-collapse-toggle"
          onClick={() => setCollapsed(true)}
          aria-label="Collapse panel"
          title="Collapse panel"
        >
          ▸
        </button>
      </div>
      <div className="dock-content" role="tabpanel" aria-labelledby={`dock-tab-${active.id}`}>
        {active.render()}
      </div>
    </aside>
  );
}

// Re-export for tests / introspection.
export const __test = { inspectorEnabled };
