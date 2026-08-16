import { createDb } from '../../src/db.js';
import { migrationConfig } from '../../src/migrate.js';

/**
 * Banco de teste: Postgres real (DATABASE_URL). Faz rollback total + latest
 * para garantir schema limpo. Nunca SQLite (D6).
 */
export async function freshDb() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL obrigatória nos testes');
  const db = createDb(process.env.DATABASE_URL);
  await db.migrate.rollback(migrationConfig, true);
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
