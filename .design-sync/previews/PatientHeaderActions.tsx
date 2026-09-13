import { PatientHeaderActions } from '@medcheckin/web';

export function Ativo() {
  return <PatientHeaderActions patientId="p1" status="active" />;
}

export function Pausado() {
  return <PatientHeaderActions patientId="p1" status="paused" />;
}
