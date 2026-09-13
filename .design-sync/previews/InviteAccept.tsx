import { InviteAccept } from '@medcheckin/web';

export function Convite() {
  return (
    <div className="w-[520px]">
      <InviteAccept
        token="tok-2"
        name="João Souza"
        kind="caregiver"
        patientName="Maria Souza"
        clinicName="Clínica Vida"
        alreadyAccepted={false}
      />
    </div>
  );
}

export function JaAceito() {
  return (
    <div className="w-[520px]">
      <InviteAccept
        token="tok-1"
        name="Maria Souza"
        kind="patient"
        patientName="Maria Souza"
        clinicName="Clínica Vida"
        alreadyAccepted
      />
    </div>
  );
}
