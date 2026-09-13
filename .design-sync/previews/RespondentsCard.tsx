import { RespondentsCard } from '@medcheckin/web';
import { RESPONDENTS } from './_fixtures';

export function ComRespondentes() {
  return (
    <div className="w-[560px]">
      <RespondentsCard patientId="p1" respondents={RESPONDENTS} />
    </div>
  );
}

export function Vazio() {
  return (
    <div className="w-[560px]">
      <RespondentsCard patientId="p1" respondents={[]} />
    </div>
  );
}
