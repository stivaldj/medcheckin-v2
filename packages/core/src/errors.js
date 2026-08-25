/** Erro de validação de entrada (campo opcional). Usado por todos os serviços. */
export class ValidationError extends Error {
  constructor(message, field = null) {
    super(message);
    this.code = 'validation';
    this.field = field;
  }
}
