import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
  Input,
} from '@medcheckin/web';

export function EntreCampos() {
  return (
    <div className="w-[420px]">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="email">E-mail do respondente</FieldLabel>
          <Input id="email" defaultValue="maria.souza@exemplo.com" />
        </Field>
        <FieldSeparator>ou</FieldSeparator>
        <Field>
          <FieldLabel htmlFor="tel">Telefone</FieldLabel>
          <Input id="tel" placeholder="+55 11 99999-0000" />
          <FieldDescription>Usado apenas para o link de convite.</FieldDescription>
        </Field>
      </FieldGroup>
    </div>
  );
}

export function Simples() {
  return (
    <div className="w-[420px]">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="n">Nome</FieldLabel>
          <Input id="n" defaultValue="Maria Souza" />
        </Field>
        <FieldSeparator />
        <Field>
          <FieldLabel htmlFor="c">Condições</FieldLabel>
          <Input id="c" defaultValue="dor crônica" />
        </Field>
      </FieldGroup>
    </div>
  );
}
