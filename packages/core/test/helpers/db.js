import { createDb } from '../../src/db.js';
import { migrationConfig } from '../../src/migrate.js';

/**
 * Banco de teste: Postgres real (DATABASE_URL). Faz rollback total + latest
 * para garantir schema limpo. Nunca SQLite (D6).
 */
export async function freshDb() {
  const url = process.env.DATABASE_URL_TEST || process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL_TEST (ou DATABASE_URL) obrigatória nos testes');
  const db = createDb(url);
  // Schema limpo de verdade (imune a bugs de `down`); os `down` são exercitados em migrations.test.js.
  await db.raw('drop schema public cascade; create schema public');
  await db.migrate.latest(migrationConfig);
  return db;
}

/** Fixture mínima: 1 clínica + 1 médica. Devolve ids. */
export async function seedClinic(db, suffix = 'a') {
  const [clinic] = await db('clinics')
    .insert({ name: `Clínica Teste ${suffix}` })
    .returning('id');
  const [user] = await db('users')
    .insert({
      clinic_id: clinic.id,
      role: 'doctor',
      email: `dra-${suffix}@example.test`,
      name: 'Dra. Teste',
    })
    .returning('id');
  return { clinicId: clinic.id, userId: user.id };
}

export async function seedPatient(db, { clinicId, userId }, name = 'Paciente Teste') {
  const [p] = await db('patients')
    .insert({ clinic_id: clinicId, name, timezone: 'America/Cuiaba', created_by: userId })
    .returning('id');
  return p.id;
}

/**
 * Fixture completa a partir do seed sintético (D7). Devolve ids úteis por nome.
 * P1: adulto, responde sozinho, episódio daily, dose vigente 4 gotas 08:00/20:00.
 * P2: criança (can_answer=false), cuidadora responde, episódio weekly, 0.5 ml 07:00/13:00/21:00.
 */
export async function seedFixture(db) {
  const { runSeed } = await import('../../src/seed/index.js');
  await runSeed(db, { reset: true });
  const clinic = await db('clinics').first();
  const doctor = await db('users').first();
  const p1 = await db('patients').where({ name: 'Paciente Sintético Um' }).first();
  const p2 = await db('patients').where({ name: 'Paciente Sintético Dois' }).first();
  const r1 = await db('respondents').where({ patient_id: p1.id, kind: 'patient' }).first();
  const r2p = await db('respondents').where({ patient_id: p2.id, kind: 'patient' }).first();
  const r2c = await db('respondents').where({ patient_id: p2.id, kind: 'caregiver' }).first();
  const m1 = await db('medications').where({ patient_id: p1.id }).first();
  const m2 = await db('medications').where({ patient_id: p2.id }).first();
  const ep1 = await db('episodes').where({ patient_id: p1.id }).first();
  const ep2 = await db('episodes').where({ patient_id: p2.id }).first();
  const qs = await db('question_sets').first();
  const questions = await db('questions').where({ question_set_id: qs.id }).orderBy('sort_order');
  const q = Object.fromEntries(questions.map((x) => [x.key, x]));
  return { clinic, doctor, p1, p2, r1, r2p, r2c, m1, m2, ep1, ep2, qs, q };
}

/** Notifier de teste: registra chamadas; falha quando `failNext` ou `failFor(respondentId)`. */
export function fakeNotifier() {
  const sent = [];
  const state = { failNext: 0, failIds: new Set() };
  return {
    sent,
    state,
    async send(notification) {
      if (state.failNext > 0) {
        state.failNext -= 1;
        return { ok: false, error: 'fake: falha simulada' };
      }
      if (state.failIds.has(notification.respondent_id))
        return { ok: false, error: 'fake: respondente sem push' };
      sent.push(notification);
      return { ok: true };
    },
  };
}
