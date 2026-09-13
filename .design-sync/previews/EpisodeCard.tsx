import { EpisodeCard } from '@medcheckin/web';
import { EPISODE, QUESTION_SETS } from './_fixtures';

export function Titulacao() {
  return (
    <div className="w-[560px]">
      <EpisodeCard patientId="p1" episode={EPISODE} questionSets={QUESTION_SETS} />
    </div>
  );
}

export function Manutencao() {
  return (
    <div className="w-[560px]">
      <EpisodeCard
        patientId="p1"
        episode={{ ...EPISODE, kind: 'maintenance', checkin_frequency: 'weekly' }}
        questionSets={QUESTION_SETS}
      />
    </div>
  );
}
