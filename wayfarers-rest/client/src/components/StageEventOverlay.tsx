/**
 * Phase 9 (F2): in-tavern stage event overlay.
 *
 * When a scene is live, draws:
 *   - A coloured halo over the affected zone (pulses on `building`,
 *     intensifies on `underway` + `climax`, fades on `aftermath`).
 *   - A caption strip across the top of the play area ("Scene: brawl
 *     at the bar"), one line per live scene.
 *
 * The participants pulse — that's handled inside Tavern.tsx by
 * passing a `sceneParticipant` flag to each Npc, so it composes with
 * the existing focus/regular/interaction effects.
 *
 * F2 is presentational; the runner + persistence + events already shipped
 * in F1. F4 will let the keeper escalate/defuse from this overlay; F3
 * adds three more scene types (the halo/caption code branches on type).
 */
import type { StageEvent, StageEventType, Zone } from '@shared/types';
import { useStore } from '../state/store.tsx';

const TYPE_LABELS: Record<StageEventType, string> = {
  brawl: 'A brawl',
  wedding: 'A wedding',
  court_day: 'A court day',
  storyteller_circle: 'A storyteller circle',
};

/** Per-type colour for the zone halo. Hue + a single alpha — CSS variables
 *  on the wrapper drive the keyframe so each scene type reads at a glance.
 *  Brawl is warm-red; the rest follow when F3 ships. */
const TYPE_HUES: Record<StageEventType, string> = {
  brawl: '0 70% 55%',
  wedding: '45 80% 60%',
  court_day: '215 50% 55%',
  storyteller_circle: '160 50% 55%',
};

export function StageEventOverlay() {
  const { stageEvents, zones } = useStore();
  if (!stageEvents || stageEvents.length === 0) return null;

  // Filter out anything that somehow survived past `resolved` — defence
  // against a stale snapshot from before a cleanup pass.
  const live = stageEvents.filter((s) => s.state !== 'resolved');
  if (live.length === 0) return null;

  const zonesByName = new Map(zones.map((z) => [z.name, z]));

  return (
    <>
      <div className="stage-overlay" aria-live="polite">
        {live.map((scene) => {
          const zone = zonesByName.get(scene.zone);
          if (!zone) return null;
          return <StageHalo key={scene.id} scene={scene} zone={zone} />;
        })}
      </div>
      <div className="stage-captions" data-testid="stage-captions">
        {live.map((scene) => {
          const where =
            zonesByName.get(scene.zone)?.name.replace(/_/g, ' ') ?? scene.zone;
          return (
            <div
              key={scene.id}
              className={`stage-caption stage-caption--${scene.type} stage-caption--${scene.state}`}
              data-scene-id={scene.id}
              data-scene-type={scene.type}
              data-scene-state={scene.state}
            >
              <span className="stage-caption-marker" aria-hidden>
                ●
              </span>
              <span className="stage-caption-text">
                {TYPE_LABELS[scene.type]} at the {where}
              </span>
              <span className="stage-caption-state">{scene.state}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}

function StageHalo({ scene, zone }: { scene: StageEvent; zone: Zone }) {
  // Zone position + radius are in tavern-percent of the play area; the
  // halo wraps a circle ~2x the radius so its outer glow extends naturally.
  const style: React.CSSProperties = {
    left: `${zone.x}%`,
    top: `${zone.y}%`,
    width: `${zone.radius * 2.4}%`,
    height: `${zone.radius * 2.4}%`,
    // Pass the per-type hue through to the keyframe.
    ['--stage-hue' as string]: TYPE_HUES[scene.type],
  };
  return (
    <div
      className={`stage-halo stage-halo--${scene.type} stage-halo--${scene.state}`}
      data-scene-id={scene.id}
      style={style}
      aria-hidden
    />
  );
}

/**
 * Phase 9 (F2): list of NPC ids currently caught up in a live scene. Used
 * by Tavern.tsx to flag each Npc so the matching sprite pulses. Pure
 * selector; safe to call from a memo'd parent component.
 */
export function sceneParticipantSet(
  stageEvents: StageEvent[] | undefined,
): Set<string> {
  const out = new Set<string>();
  if (!stageEvents) return out;
  for (const s of stageEvents) {
    if (s.state === 'resolved') continue;
    for (const id of s.participantNpcIds) out.add(id);
  }
  return out;
}
