import { createHash } from 'node:crypto';
import { toDT } from '../time.js';
import { AuthError, newToken } from '../auth/tokens.js';
import { requirePatientInClinic, logAccess } from '../auth/access.js';
import { logger } from '../logger.js';

function requireDoctor(session) {
  if (!session || session.kind !== 'user')
    throw new AuthError('unauthenticated', 'Sessão da clínica necessária.');
}

/**
 * Anonimização (LGPD): remove identificadores e texto livre; MANTÉM séries clínicas (valores numéricos/
 * escolhas, scores, doses, alertas e condutas) — o prontuário tem guarda legal; ver docs/LGPD.md.
 * Idempotente. Revoga sessões e inscrições push dos respondentes.
 */
export async function anonymizePatient(db, session, patientId, { reason }, now) {
  requireDoctor(session);
  await requirePatientInClinic(db, session, patientId);
  const why = String(reason ?? '').trim();
  if (!why) throw new AuthError('validation', 'Informe o motivo da anonimização.');
  const nowJs = toDT(now).toJSDate();
  const tag = createHash('sha256').update(patientId).digest('hex').slice(0, 8);
  const anonName = `Paciente anonimizado ${tag}`;

  return db.transaction(async (trx) => {
    const [patient] = await trx('patients')
      .where({ id: patientId })
      .update({
        name: anonName,
        birth_date: null,
        status: 'discharged',
        // D28: é este campo, e não o status, que diz "anonimizado" — alta grava o mesmo status.
        // coalesce mantém a data da primeira anonimização quando a operação é repetida.
        anonymized_at: trx.raw('coalesce(anonymized_at, ?)', [nowJs]),
        updated_at: trx.fn.now(),
      })
      .returning('*');
    const respondents = await trx('respondents')
      .where({ patient_id: patientId })
      .orderBy('created_at');
    for (const [i, r] of respondents.entries()) {
      await trx('respondents')
        .where({ id: r.id })
        .update({
          name: `Respondente ${i + 1}`,
          email: null,
          phone: null,
          relationship: null,
          invite_token: newToken(),
          updated_at: trx.fn.now(),
        });
      await trx('sessions')
        .where({ respondent_id: r.id })
        .whereNull('revoked_at')
        .update({ revoked_at: nowJs });
      await trx('push_subscriptions').where({ respondent_id: r.id }).del();
    }
    await trx('answers')
      .whereIn('checkin_id', trx('checkins').select('id').where({ patient_id: patientId }))
      .whereNotNull('value_text')
      .update({ value_text: '[removido]' });
    /**
     * P2-2 — pergunta criada para este paciente é texto livre da médica: tanto o enunciado
     * ("Como está a dona Maria?") quanto a chave derivada dele podem carregar o nome. Vira
     * `Pergunta extra N` / `extra_N`, numerada de forma estável.
     *
     * A série NÃO se perde: `answers.question_id` continua apontando para a mesma linha, então
     * valores, datas e limiar de alerta seguem intactos — só o texto que identificava sai.
     */
    const extras = await trx('questions')
      .where({ patient_id: patientId })
      .orderBy('sort_order')
      .orderBy('created_at')
      .select('id');
    for (const [i, q] of extras.entries()) {
      await trx('questions')
        .where({ id: q.id })
        .update({ label: `Pergunta extra ${i + 1}`, key: `extra_${i + 1}` });
    }
    await trx('notifications')
      .where({ patient_id: patientId })
      .update({ payload: JSON.stringify({}) });
    /**
     * DECISÃO (26/08, dono + médica): a CONDUTA CLÍNICA é preservada na anonimização —
     * `alert_actions.note` e `alerts.context` NÃO são apagados.
     *
     * O que a médica escreveu ao resolver um alerta é prontuário, e prontuário tem obrigação de
     * guarda própria (CFM 1.821/2007), que não cai porque o titular pediu para sair. Apagar a
     * conduta deixaria a série clínica sem a explicação do que foi feito — o oposto do que a
     * anonimização protege, que é a IDENTIDADE, não o histórico.
     *
     * Consequência assumida: é texto livre, então pode conter nome de terceiro digitado pela
     * médica. Isso é mitigado no ponto de escrita (aviso na tela de anonimização), não aqui.
     * O teste em lgpd.test.js trava esta decisão para ninguém "consertar" por engano.
     */
    const medIds = trx('medications').select('id').where({ patient_id: patientId });
    await trx('dose_events').whereIn('medication_id', medIds).update({ note: null });
    await trx('medication_intakes').whereIn('medication_id', medIds).update({ note: null });
    await trx('routine_periods').where({ patient_id: patientId }).update({ note: null });
    await logAccess(
      trx,
      { session, patientId, route: `patients.anonymize:${why.slice(0, 120)}`, action: 'anonymize' },
      now,
    );
    logger.info('lgpd.anonymized', { patient_id: patientId, respondents: respondents.length });
    return { patient, respondents: respondents.length };
  });
}
