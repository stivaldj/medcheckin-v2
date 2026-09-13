import {
  Checkbox,
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  Input,
  SimpleSelect,
  Textarea,
} from '@medcheckin/web';

export function Formulario() {
  return (
    <FieldSet className="w-[380px]">
      <FieldLegend>Prescrição</FieldLegend>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="produto">Produto</FieldLabel>
          <Input id="produto" defaultValue="Óleo full spectrum 200mg/ml" />
          <FieldDescription>Como está no rótulo do frasco.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="periodo">Período</FieldLabel>
          <SimpleSelect
            value="noite"
            onValueChange={() => {}}
            options={[
              { value: 'manha', label: 'Manhã' },
              { value: 'tarde', label: 'Tarde' },
              { value: 'noite', label: 'Noite' },
            ]}
          />
        </Field>
      </FieldGroup>
    </FieldSet>
  );
}

export function ComErro() {
  return (
    <div className="w-[380px]">
      <Field>
        <FieldLabel htmlFor="dose">Dose por tomada</FieldLabel>
        <Input id="dose" type="number" defaultValue="999" aria-invalid />
        <FieldError errors={[{ message: 'Acima do teto definido para esta prescrição.' }]} />
      </Field>
    </div>
  );
}

export function Horizontal() {
  return (
    <div className="w-[420px]">
      <Field orientation="horizontal">
        <Checkbox id="lembrete" defaultChecked />
        <FieldLabel htmlFor="lembrete">Enviar lembrete push</FieldLabel>
      </Field>
    </div>
  );
}

export function TextoLivre() {
  return (
    <div className="w-[380px]">
      <Field>
        <FieldLabel htmlFor="obs">Observações</FieldLabel>
        <Textarea id="obs" defaultValue="Paciente relata melhora no sono a partir da 2ª semana." />
        <FieldDescription>Visível apenas para a equipe clínica.</FieldDescription>
      </Field>
    </div>
  );
}
