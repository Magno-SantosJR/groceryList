export interface Produto {
  id?: string;
  nome: string;
  categoria: string;
  unidade_padrao?: string;
}

export interface ItemLista {
  id?: string;
  produto_id?: string;
  produto_nome: string;
  categoria?: string;
  quantidade: number;
  unidade_medida?: string;
  medida_embalagem?: string;
  marca_sugerida?: string;
  adicionado_por: 'Magno' | 'Francine';
  status: 'pendente' | 'comprado';
  criado_em?: string;
}

export interface CompraFechada {
  id: string;
  supermercado: string;
  data_compra: string;
  hora_compra?: string;
  valor_total: number;
  quantidade_itens: number;
  comprado_por: 'Magno' | 'Francine';
  forma_pagamento?: string;
  observacao?: string;
  criado_em?: string;
}

export interface RegistroPreco {
  id?: string;
  compra_id?: string;
  produto_id?: string;
  produto_nome: string;
  categoria?: string;
  marca?: string;
  medida_embalagem?: string;
  quantidade?: number;
  preco_unitario: number;
  desconto: number;
  preco_final: number;
  preco_por_base?: number;
  unidade_base?: string;
  supermercado: string;
  tipo_origem: 'compra' | 'propaganda';
  registrado_por: 'Magno' | 'Francine';
  data_registro?: string;
}