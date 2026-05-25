import { useState, type ReactElement } from 'react';
import type {
  InterventionKind,
  RumorTone,
  SwayDirection,
} from '@shared/types';
import { api } from '../api.ts';
import { useDispatch, useStore } from '../state/store.tsx';

type Step = 'kind' | 'target' | 'confirm';

/** Economy (E3): coin-costed verbs that take no target — skip the target step. */
const NO_TARGET_KINDS: ReadonlySet<InterventionKind> = new Set<InterventionKind>([
  'restock_larder',
  'upgrade_hearth',
]);

export function InterventionPicker() {
  const { interventionPickerOpen, interventionOptions, world } = useStore();
  const dispatch = useDispatch();
  const [step, setStep] = useState<Step>('kind');
  const [kind, setKind] = useState<InterventionKind | null>(null);
  const [payload, setPayload] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!interventionPickerOpen || !interventionOptions || !world) return null;

  const close = () => {
    setStep('kind');
    setKind(null);
    setPayload({});
    setError(null);
    dispatch({ type: 'INTERVENTION_PICKER_CLOSED' });
  };

  const pickKind = (next: InterventionKind) => {
    setKind(next);
    setPayload({});
    setStep(NO_TARGET_KINDS.has(next) ? 'confirm' : 'target');
  };

  const goConfirm = () => {
    setError(null);
    setStep('confirm');
  };

  const confirm = async () => {
    if (!kind) return;
    setBusy(true);
    setError(null);
    try {
      await api.postIntervention(kind, payload);
      // The SSE world_event will dispatch INTERVENTION_LANDED + update state;
      // we just need to close the picker.
      close();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="intervention-picker" data-testid="intervention-picker">
      <header className="intervention-picker-header">
        <span>{titleForStep(step, kind)}</span>
        <button
          type="button"
          className="intervention-picker-close"
          onClick={close}
          data-testid="intervention-picker-close"
        >
          ×
        </button>
      </header>

      {step === 'kind' && (
        <KindList
          kinds={interventionOptions.kinds}
          onPick={pickKind}
        />
      )}

      {step === 'target' && kind && (
        <TargetPicker
          kind={kind}
          payload={payload}
          setPayload={setPayload}
          onCancel={() => setStep('kind')}
          onContinue={goConfirm}
        />
      )}

      {step === 'confirm' && kind && (
        <ConfirmStep
          kind={kind}
          payload={payload}
          busy={busy}
          error={error}
          onCancel={() => setStep(NO_TARGET_KINDS.has(kind) ? 'kind' : 'target')}
          onConfirm={confirm}
        />
      )}
    </aside>
  );
}

function titleForStep(step: Step, kind: InterventionKind | null): string {
  if (step === 'kind') return 'Intervene';
  if (step === 'target') return `Configure: ${kind}`;
  return `Confirm: ${kind}`;
}

function KindList({
  kinds,
  onPick,
}: {
  kinds: ReturnType<typeof useStore>['interventionOptions'] extends infer T
    ? T extends null
      ? never
      : T extends { kinds: infer K }
        ? K
        : never
    : never;
  onPick: (k: InterventionKind) => void;
}) {
  return (
    <ul className="intervention-kinds">
      {kinds.map((k) => (
        <li key={k.kind}>
          <button
            type="button"
            className="intervention-kind"
            disabled={!k.available}
            onClick={() => onPick(k.kind)}
            title={k.unavailableReason ?? ''}
            data-testid={`intervention-kind-${k.kind}`}
          >
            <span className="intervention-kind-name">{labelForKind(k.kind)}</span>
            <span className="intervention-kind-cost">
              cost {k.cost} {k.costCurrency}
            </span>
            {!k.available && k.unavailableReason && (
              <span className="intervention-kind-reason">{k.unavailableReason}</span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

function labelForKind(kind: InterventionKind): string {
  switch (kind) {
    case 'plant_rumor':
      return 'Whisper a rumor';
    case 'beckon':
      return 'Send for a traveler';
    case 'sway_thread':
      return 'Bless or curse a thread';
    case 'stir_world':
      return 'Stir the wider world';
    case 'mark_npc':
      return 'Mark a guest';
    case 'restock_larder':
      return 'Restock the larder';
    case 'upgrade_hearth':
      return 'Upgrade the hearth';
    case 'shift_focus':
      return "Shift the tavern's focus";
  }
}

function TargetPicker({
  kind,
  payload,
  setPayload,
  onCancel,
  onContinue,
}: {
  kind: InterventionKind;
  payload: Record<string, unknown>;
  setPayload: (p: Record<string, unknown>) => void;
  onCancel: () => void;
  onContinue: () => void;
}) {
  const { interventionOptions } = useStore();
  if (!interventionOptions) return null;
  const targets = interventionOptions.targets;

  let body: ReactElement;
  let canContinue = false;

  if (kind === 'plant_rumor') {
    const locationId = payload.locationId as string | undefined;
    const tone = (payload.tone as RumorTone | undefined) ?? 'curious';
    canContinue = !!locationId;
    body = (
      <>
        <label>
          Location:
          <select
            data-testid="picker-location"
            value={locationId ?? ''}
            onChange={(e) => setPayload({ ...payload, locationId: e.target.value })}
          >
            <option value="">— choose —</option>
            {targets.locations.map((l) => (
              <option key={l.id} value={l.id}>{l.displayName}</option>
            ))}
          </select>
        </label>
        <label>
          Tone:
          <select
            data-testid="picker-tone"
            value={tone}
            onChange={(e) => setPayload({ ...payload, tone: e.target.value })}
          >
            {(['foreboding', 'curious', 'mundane', 'urgent'] as const).map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
      </>
    );
  } else if (kind === 'beckon') {
    const archetype = payload.archetype as string | undefined;
    const offset = (payload.preferredDayOffset as number | undefined) ?? 2;
    canContinue = !!archetype;
    body = (
      <>
        <label>
          Archetype:
          <select
            data-testid="picker-archetype"
            value={archetype ?? ''}
            onChange={(e) => setPayload({ ...payload, archetype: e.target.value })}
          >
            <option value="">— choose —</option>
            {targets.archetypes.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </label>
        <label>
          Days until arrival:
          <select
            data-testid="picker-day-offset"
            value={offset}
            onChange={(e) =>
              setPayload({ ...payload, preferredDayOffset: Number(e.target.value) })
            }
          >
            {[1, 2, 3].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
      </>
    );
  } else if (kind === 'sway_thread') {
    const threadId = payload.threadId as string | undefined;
    const direction = (payload.direction as SwayDirection | undefined) ?? 'bless';
    const swayable = targets.activeThreads.filter((t) => t.canSway);
    canContinue = !!threadId;
    body = (
      <>
        <label>
          Thread:
          <select
            data-testid="picker-thread"
            value={threadId ?? ''}
            onChange={(e) => setPayload({ ...payload, threadId: e.target.value })}
          >
            <option value="">— choose —</option>
            {swayable.map((t) => (
              <option key={t.id} value={t.id}>{t.describable || t.type}</option>
            ))}
          </select>
        </label>
        <label>
          Direction:
          <select
            data-testid="picker-direction"
            value={direction}
            onChange={(e) =>
              setPayload({ ...payload, direction: e.target.value as SwayDirection })
            }
          >
            <option value="bless">bless</option>
            <option value="curse">curse</option>
          </select>
        </label>
      </>
    );
  } else if (kind === 'stir_world') {
    const tagKey = payload.tagKey as string | undefined;
    const tag = targets.worldTags.find((t) => t.key === tagKey);
    const newValue = payload.newValue as string | undefined;
    canContinue = !!(tagKey && newValue);
    body = (
      <>
        <label>
          Tag:
          <select
            data-testid="picker-tag"
            value={tagKey ?? ''}
            onChange={(e) => setPayload({ ...payload, tagKey: e.target.value, newValue: '' })}
          >
            <option value="">— choose —</option>
            {targets.worldTags.map((t) => (
              <option key={t.key} value={t.key}>
                {t.key} (currently {t.currentValue})
              </option>
            ))}
          </select>
        </label>
        {tag && (
          <label>
            New value:
            <select
              data-testid="picker-tag-value"
              value={newValue ?? ''}
              onChange={(e) => setPayload({ ...payload, newValue: e.target.value })}
            >
              <option value="">— choose —</option>
              {tag.permittedValues
                .filter((v) => v !== tag.currentValue)
                .map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
            </select>
          </label>
        )}
      </>
    );
  } else {
    // mark_npc
    const npcId = payload.npcId as string | undefined;
    const unmarked = targets.npcsInTavern.filter((n) => !n.isMarked);
    canContinue = !!npcId;
    body = (
      <label>
        Guest:
        <select
          data-testid="picker-npc"
          value={npcId ?? ''}
          onChange={(e) => setPayload({ ...payload, npcId: e.target.value })}
        >
          <option value="">— choose —</option>
          {unmarked.map((n) => (
            <option key={n.id} value={n.id}>
              {n.displayName} ({n.archetype}, {n.status})
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <div className="intervention-target">
      {body}
      <div className="intervention-actions">
        <button type="button" onClick={onCancel}>back</button>
        <button
          type="button"
          disabled={!canContinue}
          onClick={onContinue}
          data-testid="picker-continue"
        >
          continue
        </button>
      </div>
    </div>
  );
}

function ConfirmStep({
  kind,
  payload,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  kind: InterventionKind;
  payload: Record<string, unknown>;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const summary = summarize(kind, payload);
  return (
    <div className="intervention-confirm">
      <p className="intervention-summary">{summary}</p>
      {error && <p className="intervention-error">{error}</p>}
      <div className="intervention-actions">
        <button type="button" onClick={onCancel} disabled={busy}>
          back
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          data-testid="picker-confirm"
        >
          {busy ? 'sending…' : 'confirm'}
        </button>
      </div>
    </div>
  );
}

function summarize(kind: InterventionKind, p: Record<string, unknown>): string {
  switch (kind) {
    case 'plant_rumor':
      return `Whisper a ${String(p.tone ?? 'curious')} rumor toward ${p.locationId}.`;
    case 'beckon':
      return `Send for a ${p.archetype}, due in ${p.preferredDayOffset ?? 2} day(s).`;
    case 'sway_thread':
      return `${p.direction === 'bless' ? 'Bless' : 'Curse'} thread ${p.threadId}.`;
    case 'stir_world':
      return `Stir ${p.tagKey} to ${p.newValue}.`;
    case 'mark_npc':
      return `Mark ${p.npcId} for the keeper's attention.`;
    case 'restock_larder':
      return 'Spend coin to restock the larder — guests will eat better.';
    case 'upgrade_hearth':
      return 'Spend coin to build up the hearth and common room.';
    case 'shift_focus':
      return `Swap ${p.dropTrait} for ${p.addTrait} (costs 3 favors).`;
  }
}
