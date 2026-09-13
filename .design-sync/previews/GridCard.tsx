import { GridCard } from '@medcheckin/web';
import { GRID, DIRECOES } from './_fixtures';

export function SeteDias() {
  return <GridCard grid={GRID} direcoes={DIRECOES} />;
}
