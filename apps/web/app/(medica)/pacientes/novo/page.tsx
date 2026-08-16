import { NewPatientForm } from '@/components/medica/NewPatientForm';

export default function NovoPacientePage() {
  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold">Novo paciente</h1>
      <NewPatientForm />
    </div>
  );
}
