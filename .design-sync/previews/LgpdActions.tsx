import { LgpdActions } from '@medcheckin/web';

export function EmAcompanhamento() {
  return <LgpdActions patientId="p1" patientName="Maria Souza" discharged={false} />;
}

export function ComAlta() {
  return <LgpdActions patientId="p1" patientName="Maria Souza" discharged />;
}
