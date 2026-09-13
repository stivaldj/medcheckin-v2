import { MedicationsCard } from '@medcheckin/web';
import { MEDICATIONS, PRODUCTS, QUESTION_SETS } from './_fixtures';

export function ComMedicacoes() {
  return (
    <div className="w-[600px]">
      <MedicationsCard
        patientId="p1"
        medications={MEDICATIONS}
        products={PRODUCTS}
        questionSets={QUESTION_SETS}
      />
    </div>
  );
}

export function Vazio() {
  return (
    <div className="w-[600px]">
      <MedicationsCard patientId="p1" medications={[]} products={PRODUCTS} questionSets={QUESTION_SETS} />
    </div>
  );
}
