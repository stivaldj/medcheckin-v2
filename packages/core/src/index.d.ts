import type { Knex } from 'knex';

export interface CoreConfig {
  readonly databaseUrl: string;
}

/** Fail-closed: lança se DATABASE_URL ausente. */
export function loadConfig(env?: Record<string, string | undefined>): CoreConfig;

/** Conexão Knex com Postgres (PG-only). numeric/int8 já convertidos para number. */
export function createDb(databaseUrl: string): Knex;

export const migrationConfig: Readonly<Knex.MigratorConfig>;
export function migrateLatest(db: Knex): Promise<{ batch: number; files: string[] }>;
export function migrateRollbackAll(db: Knex): Promise<unknown>;

export interface DoseEvent {
  id: string;
  medication_id: string;
  effective_from: Date;
  dose_amount: number;
  dose_unit: string;
  times_per_day: number;
  schedule_times: string[];
  reason: string | null;
  note: string | null;
  created_by: string;
  created_at: Date;
}
/** Dose vigente em `at` (default: agora). null quando não há ajuste vigente. */
export function currentDose(db: Knex, medicationId: string, at?: Date): Promise<DoseEvent | null>;

export interface SeedCounts {
  clinics: number;
  users: number;
  patients: number;
  respondents: number;
  products: number;
  medications: number;
  dose_events: number;
  question_sets: number;
  questions: number;
  episodes: number;
}
/** Seed sintético (D7). Recusa banco populado salvo reset. */
export function runSeed(db: Knex, opts?: { reset?: boolean }): Promise<SeedCounts>;
