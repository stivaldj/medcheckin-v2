import { LgpdActions } from '@medcheckin/web';

// D28: o que decide o botão "Anonimizar" é `anonymizedAt`, não o status — paciente em
// acompanhamento e paciente com alta renderizam igual aqui, e os dois podem pedir a exclusão.
export function NaoAnonimizado() {
  return <LgpdActions patientId="p1" patientName="Maria Souza" anonymizedAt={null} />;
}

export function Anonimizado() {
  return (
    <LgpdActions
      patientId="p1"
      patientName="Paciente anonimizado 3f9a12c4"
      anonymizedAt="2026-09-10T15:00:00Z"
    />
  );
}
