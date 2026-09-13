import {
  Badge,
  Button,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from '@medcheckin/web';
import { PillIcon, DropletIcon } from 'lucide-react';

export function Lista() {
  return (
    <div className="w-[460px]">
      <ItemGroup>
        <Item variant="outline">
          <ItemMedia>
            <DropletIcon />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>Óleo full spectrum 200mg/ml</ItemTitle>
            <ItemDescription>2 gotas sublinguais, manhã e noite</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Button size="xs" variant="ghost">
              Editar
            </Button>
          </ItemActions>
        </Item>
        <ItemSeparator />
        <Item variant="outline">
          <ItemMedia>
            <PillIcon />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>Cápsula 25mg</ItemTitle>
            <ItemDescription>1 ao dia, após o almoço</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Badge variant="outline">Ativa</Badge>
          </ItemActions>
        </Item>
      </ItemGroup>
    </div>
  );
}

export function Variantes() {
  return (
    <div className="flex w-[420px] flex-col gap-2">
      <Item>
        <ItemContent>
          <ItemTitle>default</ItemTitle>
          <ItemDescription>Sem moldura</ItemDescription>
        </ItemContent>
      </Item>
      <Item variant="outline">
        <ItemContent>
          <ItemTitle>outline</ItemTitle>
          <ItemDescription>Com borda</ItemDescription>
        </ItemContent>
      </Item>
      <Item variant="muted">
        <ItemContent>
          <ItemTitle>muted</ItemTitle>
          <ItemDescription>Fundo suave</ItemDescription>
        </ItemContent>
      </Item>
    </div>
  );
}
