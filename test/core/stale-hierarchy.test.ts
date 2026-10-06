import { beforeEach, describe, expect, it } from 'vitest';
import { useCore } from '../support/with-core.js';

describe('stale hierarchy signal', () => {
  // The clock starts on Tuesday 2026-08-11 at 09:00 UTC.
  const h = useCore();
  let marta: string;
  let juan: string;

  beforeEach(() => {
    marta = h.core.addPerson({ name: 'Marta' }).id;
    juan = h.core.addPerson({ name: 'Juan' }).id;
    h.core.grantRole(marta, 'triager');
    h.core.grantRole(marta, 'consolidator');
  });

  /** The signal where the surfaces read it: hanging off the hierarchy in force. */
  const signal = () => h.core.currentHierarchy().staleness;

  /** Leaves the action accepted and unconsolidated: that is what ages. */
  const accepted = (text: string) => {
    const action = h.core.registerAction({
      text,
      initiative: 'Checkout',
      assignee: juan,
      actor: marta,
    });
    h.core.acceptAction(action.id, { actor: marta });
    return action.id;
  };

  it('marks the hierarchy stale since the day the threshold was crossed', () => {
    accepted('Aceptada el martes por la mañana');

    h.clock.set('2026-08-14T10:00:00.000Z');

    // It is neither the day of acceptance (Tuesday) nor the day of the query (Friday): it is
    // Thursday, when that action turned 48 business hours old without anyone consolidating.
    expect(signal()).toEqual({
      since: '2026-08-13T09:00:00.000Z',
      thresholdBusinessHours: 48,
    });
  });

  it('does not count the weekend: what was accepted on Friday holds until Tuesday', () => {
    h.clock.set('2026-08-14T10:00:00.000Z');
    accepted('Aceptada el viernes a media mañana');

    // Monday at noon: 50 calendar hours have passed, but only 26 business hours.
    h.clock.set('2026-08-17T12:00:00.000Z');
    expect(signal()).toBeNull();

    // The 48 are up on Tuesday at the same hour: 14 from Friday, 24 from Monday and 10 more.
    h.clock.set('2026-08-18T10:00:00.000Z');
    expect(signal()).toMatchObject({ since: '2026-08-18T10:00:00.000Z' });
  });

  it('switches off on consolidation, which is exactly what the signal asks for', () => {
    const pendiente = accepted('Aceptada y sin ordenar');
    h.core.placeInDraft(pendiente);
    h.clock.set('2026-08-14T10:00:00.000Z');
    expect(signal()).not.toBeNull();

    h.core.consolidate({ actor: marta, reason: 'Se firma lo acordado el martes' });

    expect(signal()).toBeNull();
  });

  it('warns even when nobody has ever consolidated, which is when it matters most', () => {
    accepted('Aceptada sin que nadie haya firmado nunca una jerarquía');

    h.clock.set('2026-08-14T10:00:00.000Z');

    expect(h.core.currentConsolidation()).toBeNull();
    expect(signal()).toMatchObject({ since: '2026-08-13T09:00:00.000Z' });
  });

  it('starts counting on Monday what was accepted on Saturday', () => {
    h.clock.set('2026-08-15T11:00:00.000Z');
    accepted('Aceptada en sábado, tras la reunión del viernes');

    // The count starts Monday at 00:00, so the 48 business hours (all of Monday and all
    // of Tuesday) are up on Wednesday at that same hour.
    h.clock.set('2026-08-18T23:59:59.000Z');
    expect(signal()).toBeNull();

    h.clock.set('2026-08-19T00:00:00.000Z');
    expect(signal()).toMatchObject({ since: '2026-08-19T00:00:00.000Z' });
  });

  it('waits for Monday when the threshold runs out right at the end of Friday', () => {
    h.clock.set('2026-08-13T00:00:00.000Z');
    accepted('Aceptada al filo del jueves');

    // The 48 hours run out exactly as Friday ends. The signal does not fire on Saturday:
    // it never names a day on which nobody could have consolidated, and over the weekend
    // nobody would read the warning nor could anything be done about it.
    h.clock.set('2026-08-15T12:00:00.000Z');
    expect(signal()).toBeNull();
    h.clock.set('2026-08-16T23:00:00.000Z');
    expect(signal()).toBeNull();

    h.clock.set('2026-08-17T00:00:00.000Z');
    expect(signal()).toMatchObject({ since: '2026-08-17T00:00:00.000Z' });
  });

  it('does not move the stale-since date no matter how much time passes', () => {
    accepted('La que envejece');

    h.clock.set('2026-08-14T10:00:00.000Z');
    const elViernes = signal();
    h.clock.set('2026-08-27T18:00:00.000Z');
    const dosSemanasDespues = signal();

    // «Since day X» is a date in the past that does not move: if it changed on every
    // query, nobody could say how long the hierarchy has been stale.
    expect(elViernes).toEqual(dosSemanasDespues);
  });

  it('the date is set by the oldest acceptance still unconsolidated', () => {
    accepted('La más vieja, del martes');
    h.clock.set('2026-08-12T15:00:00.000Z');
    accepted('Una más nueva, del miércoles');

    h.clock.set('2026-08-17T09:00:00.000Z');

    expect(signal()).toMatchObject({ since: '2026-08-13T09:00:00.000Z' });
  });

  it('restarts the count for an action removed from the already consolidated order', () => {
    const sacada = accepted('Entra y sale del orden');
    h.core.placeInDraft(sacada);
    h.core.consolidate({ actor: marta, reason: 'Primer orden' });

    h.clock.set('2026-08-13T09:00:00.000Z');
    h.core.removeFromDraft(sacada, marta);

    // It is accepted and unconsolidated again, but since Thursday, not since Tuesday:
    // by Friday it has not yet reached the 48 business hours.
    h.clock.set('2026-08-14T10:00:00.000Z');
    expect(signal()).toBeNull();
    h.clock.set('2026-08-17T09:00:00.000Z');
    expect(signal()).toMatchObject({ since: '2026-08-17T09:00:00.000Z' });
  });

  it('switches off when the mistakenly accepted action leaves the flow through triage', () => {
    const porError = accepted('Aceptada por error');

    h.clock.set('2026-08-14T10:00:00.000Z');
    expect(signal()).not.toBeNull();
    h.core.rejectAction(porError, { actor: marta, note: 'No era para nosotros' });

    // If it could not leave, an action accepted by mistake would keep the signal
    // lit forever and nobody would pay attention to it again.
    expect(signal()).toBeNull();
  });

  it('arrives identical through the two readings the three surfaces hang from', () => {
    const pendiente = accepted('Aceptada y sin consolidar');
    h.core.placeInDraft(pendiente);
    h.core.consolidate({ actor: marta, reason: 'Primer orden' });
    h.clock.set('2026-08-12T09:00:00.000Z');
    accepted('La que se queda fuera de la jerarquía firmada');

    h.clock.set('2026-08-17T09:00:00.000Z');

    // The two web views read `currentHierarchy` and the agent reads `prioritiesFor`: the
    // signal is the same in both, not two computations that could disagree.
    expect(signal()).not.toBeNull();
    expect(h.core.prioritiesFor(juan).staleness).toEqual(signal());
  });

  it('warns even someone with nothing pending: the hierarchy belongs to everyone', () => {
    const ana = h.core.addPerson({ name: 'Ana' }).id;
    const deAna = h.core.registerAction({
      text: 'Aceptada de Ana',
      initiative: 'Checkout',
      assignee: ana,
      actor: marta,
    });
    h.core.acceptAction(deAna.id, { actor: marta });
    h.core.consolidate({ actor: marta, reason: 'Se firma en vacío' });

    h.clock.set('2026-08-14T10:00:00.000Z');
    const deJuan = h.core.prioritiesFor(juan);

    // Staleness is orthogonal to the three situations: one can have nothing pending and a
    // stale hierarchy at the same time, and Juan's agent has to be able to say so.
    expect(deJuan.situation).toBe('no_pending');
    expect(deJuan.staleness).toMatchObject({ since: '2026-08-13T09:00:00.000Z' });
  });

  it('says nothing while no accepted action is left unconsolidated', () => {
    h.core.registerAction({ text: 'Sin triar', initiative: 'Checkout', actor: marta });

    h.clock.set('2026-08-27T18:00:00.000Z');

    expect(signal()).toBeNull();
  });
});

describe('stale hierarchy signal with the threshold at 72 business hours', () => {
  const h = useCore({ config: { stalenessThresholdBusinessHours: 72 } });
  const signal = () => h.core.currentHierarchy().staleness;

  it('holds one more business day before warning, and says so when it warns', () => {
    const marta = h.core.addPerson({ name: 'Marta' }).id;
    h.core.grantRole(marta, 'triager');
    const action = h.core.registerAction({ text: 'Aceptada el martes', initiative: 'Checkout', actor: marta });
    h.core.acceptAction(action.id, { actor: marta });

    // At 48 it would be stale since Thursday; at 72 it will be stale since Friday.
    h.clock.set('2026-08-13T09:00:00.000Z');
    expect(signal()).toBeNull();

    h.clock.set('2026-08-14T09:00:00.000Z');
    expect(signal()).toEqual({
      since: '2026-08-14T09:00:00.000Z',
      thresholdBusinessHours: 72,
    });
  });
});
