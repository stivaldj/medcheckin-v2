import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { computeNextAttemptAt, planFromEpisode, inQuietHours } from '../src/scheduler/next-run.js';

const CUIABA = 'America/Cuiaba'; // UTC-4, sem DST

describe('computeNextAttemptAt (portado do v1)', () => {
  it('agenda para o mesmo dia se o próximo horário ainda está à frente', () => {
    const now = DateTime.fromISO('2026-02-16T11:00:00Z');
    expect(
      computeNextAttemptAt(now, { timezone: CUIABA, timesHm: ['09:00', '12:30', '18:00'] }),
    ).toBe('2026-02-16T13:00:00.000Z'); // 07:00 local → próximo é 09:00
  });

  it('vai para o próximo dia válido quando todos os horários passaram', () => {
    const now = DateTime.fromISO('2026-02-16T23:00:00Z');
    expect(computeNextAttemptAt(now, { timezone: CUIABA, timesHm: ['08:00', '12:00'] })).toBe(
      '2026-02-17T12:00:00.000Z',
    );
  });

  it('respeita dias da semana permitidos', () => {
    const now = DateTime.fromISO('2026-02-17T20:00:00Z'); // terça
    expect(
      computeNextAttemptAt(now, { timezone: CUIABA, daysOfWeek: [1, 3, 5], timesHm: ['09:00'] }),
    ).toBe('2026-02-18T13:00:00.000Z');
  });

  it('converte timezone deterministicamente', () => {
    const now = DateTime.fromISO('2026-02-16T11:30:00Z');
    expect(computeNextAttemptAt(now, { timezone: 'America/Sao_Paulo', timesHm: ['09:00'] })).toBe(
      '2026-02-16T12:00:00.000Z',
    );
  });

  it('empurra horários que caem em quiet hours para o fim do silêncio', () => {
    const now = DateTime.fromISO('2026-02-16T20:00:00Z');
    expect(
      computeNextAttemptAt(now, {
        timezone: CUIABA,
        timesHm: ['23:00'],
        quietStart: '22:00',
        quietEnd: '07:00',
      }),
    ).toBe('2026-02-17T11:00:00.000Z');
  });

  it('intervalDays com âncora: só dias que batem o intervalo', () => {
    const now = DateTime.fromISO('2026-02-16T10:00:00Z'); // seg; âncora 2026-02-09 (seg) → 7 dias
    expect(
      computeNextAttemptAt(now, {
        timezone: CUIABA,
        timesHm: ['09:00'],
        intervalDays: 7,
        intervalAnchorDate: '2026-02-09',
      }),
    ).toBe('2026-02-16T13:00:00.000Z'); // hoje bate o intervalo e 09:00 local ainda não passou (são 06:00)
    const later = DateTime.fromISO('2026-02-16T14:00:00Z'); // 10:00 local: já passou → próxima semana
    expect(
      computeNextAttemptAt(later, {
        timezone: CUIABA,
        timesHm: ['09:00'],
        intervalDays: 7,
        intervalAnchorDate: '2026-02-09',
      }),
    ).toBe('2026-02-23T13:00:00.000Z');
  });
});

describe('planFromEpisode (D5: frequência por episódio)', () => {
  const patient = {
    timezone: CUIABA,
    checkin_time: '09:00:00',
    quiet_start: '21:00:00',
    quiet_end: '08:00:00',
  };

  it('daily → todos os dias no horário do paciente', () => {
    const plan = planFromEpisode(
      { checkin_frequency: 'daily', started_at: new Date('2026-02-01T12:00:00Z') },
      patient,
    );
    expect(plan).toMatchObject({
      timezone: CUIABA,
      timesHm: ['09:00'],
      quietStart: '21:00',
      quietEnd: '08:00',
    });
    expect(plan.intervalDays).toBeUndefined();
  });

  it('weekly → intervalo de 7 dias ancorado no início do episódio', () => {
    const plan = planFromEpisode(
      { checkin_frequency: 'weekly', started_at: new Date('2026-02-02T12:00:00Z') },
      patient,
    );
    expect(plan).toMatchObject({ intervalDays: 7, intervalAnchorDate: '2026-02-02' });
    const now = DateTime.fromISO('2026-02-03T10:00:00Z');
    expect(computeNextAttemptAt(now, plan)).toBe('2026-02-09T13:00:00.000Z');
  });

  it('biweekly → intervalo de 14 dias', () => {
    const plan = planFromEpisode(
      { checkin_frequency: 'biweekly', started_at: new Date('2026-02-02T12:00:00Z') },
      patient,
    );
    expect(plan.intervalDays).toBe(14);
  });
});

describe('inQuietHours', () => {
  it('janela que cruza meia-noite', () => {
    const at = (h) =>
      DateTime.fromObject({ year: 2026, month: 2, day: 16, hour: h }, { zone: CUIABA });
    expect(inQuietHours(at(23), '21:00', '08:00')).toBe(true);
    expect(inQuietHours(at(3), '21:00', '08:00')).toBe(true);
    expect(inQuietHours(at(12), '21:00', '08:00')).toBe(false);
  });
});
