import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';
import { CompraFechada, ItemLista, Produto, RegistroPreco } from '../models/market.model';

@Injectable({
  providedIn: 'root'
})
export class SupabaseService {
  private supabase: SupabaseClient;

  constructor() {
    this.supabase = createClient(environment.supabaseUrl, environment.supabaseKey);
  }

  // --- CATÁLOGO DE PRODUTOS ---
  async getProdutos(): Promise<Produto[]> {
    const { data, error } = await this.supabase
      .from('produtos')
      .select('*')
      .order('nome');
    if (error) throw error;
    return data || [];
  }

  // --- LISTA DE FALTANTES ---
  async getItensFaltantes(): Promise<ItemLista[]> {
    const { data, error } = await this.supabase
      .from('lista_compras')
      .select('*')
      .eq('status', 'pendente')
      .order('criado_em', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async adicionarItemLista(item: Omit<ItemLista, 'id' | 'status' | 'criado_em'>): Promise<ItemLista> {
    const { data, error } = await this.supabase
      .from('lista_compras')
      .insert([{ ...item, status: 'pendente' }])
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  //Atualizar item existente na lista de faltas
  async atualizarItemLista(id: string, dados: Partial<ItemLista>): Promise<void> {
    const { error } = await this.supabase
      .from('lista_compras')
      .update(dados)
      .eq('id', id);
    if (error) throw error;
  }

  async removerItemLista(id: string): Promise<void> {
    const { error } = await this.supabase
      .from('lista_compras')
      .delete()
      .eq('id', id);
    if (error) throw error;
  }

  ouvirListaTempoReal(callback: () => void) {
    return this.supabase
      .channel('lista_compras_channel')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'lista_compras' },
        () => {
          callback();
        }
      )
      .subscribe();
  }

  // --- FINALIZAR COMPRA COMPLETA (MESTRE / DETALHE) ---
  async registrarCompraConcluida(
    dadosCompra: {
      supermercado: string;
      data_compra: string;
      comprado_por: 'Magno' | 'Francine';
      forma_pagamento?: string;
    },
    itensComprados: {
      itemListaId?: string;
      produto_nome: string;
      categoria?: string;
      marca?: string;
      medida_embalagem?: string;
      quantidade: number;
      preco_unitario: number;
      desconto: number;
      preco_por_base?: number;
      unidade_base?: string;
    }[]
  ): Promise<void> {
    const valorTotal = itensComprados.reduce((total, i) => {
      const precoFinal = Math.max(0, (i.preco_unitario || 0) - (i.desconto || 0));
      return total + (precoFinal * (i.quantidade || 1));
    }, 0);

    const quantidadeTotalItens = itensComprados.reduce((soma, i) => soma + (i.quantidade || 1), 0);

    // 1. Cria a compra mestre
    const { data: compraCriada, error: erroCompra } = await this.supabase
      .from('compras_fechadas')
      .insert([{
        supermercado: dadosCompra.supermercado,
        data_compra: dadosCompra.data_compra,
        valor_total: +valorTotal.toFixed(2),
        quantidade_itens: quantidadeTotalItens,
        comprado_por: dadosCompra.comprado_por,
        forma_pagamento: dadosCompra.forma_pagamento || 'Cartão'
      }])
      .select()
      .single();

    if (erroCompra) throw erroCompra;

    // 2. Insere os itens vinculados à compra
    const registrosHistorico: Partial<RegistroPreco>[] = itensComprados.map(i => ({
      compra_id: compraCriada.id,
      produto_nome: i.produto_nome,
      categoria: i.categoria || 'Geral',
      marca: i.marca || '',
      medida_embalagem: i.medida_embalagem || '',
      quantidade: i.quantidade || 1,
      preco_unitario: i.preco_unitario,
      desconto: i.desconto || 0,
      preco_final: +(i.preco_unitario - (i.desconto || 0)).toFixed(2),
      preco_por_base: i.preco_por_base,
      unidade_base: i.unidade_base || 'un',
      supermercado: dadosCompra.supermercado,
      tipo_origem: 'compra',
      registrado_por: dadosCompra.comprado_por,
      data_registro: dadosCompra.data_compra
    }));

    const { error: erroHistorico } = await this.supabase
      .from('historico_precos')
      .insert(registrosHistorico);

    if (erroHistorico) throw erroHistorico;

    // 3. Atualiza estado na lista para os itens planejados
    const idsLista = itensComprados
      .filter(i => i.itemListaId)
      .map(i => i.itemListaId!);

    if (idsLista.length > 0) {
      const { error: erroUpdate } = await this.supabase
        .from('lista_compras')
        .update({ status: 'comprado' })
        .in('id', idsLista);

      if (erroUpdate) throw erroUpdate;
    }
  }

  // --- REGISTO DE OFERTAS / PESQUISA AVULSA ---
  async registrarPrecoAvulso(registro: {
    produto_nome: string;
    categoria?: string;
    marca?: string;
    medida_embalagem?: string;
    quantidade?: number;
    preco_unitario: number;
    desconto?: number;
    preco_por_base?: number;
    unidade_base?: string;
    supermercado: string;
    tipo_origem: 'compra' | 'propaganda';
    registrado_por: 'Magno' | 'Francine';
    data_registro?: string;
  }): Promise<void> {
    const precoUnit = Number(registro.preco_unitario) || 0;
    const desc = Number(registro.desconto) || 0;

    const { error } = await this.supabase
      .from('historico_precos')
      .insert([{
        produto_nome: registro.produto_nome,
        categoria: registro.categoria || 'Geral',
        marca: registro.marca || '',
        medida_embalagem: registro.medida_embalagem || '',
        quantidade: registro.quantidade || 1,
        supermercado: registro.supermercado,
        preco_unitario: precoUnit,
        desconto: desc,
        preco_final: +(precoUnit - desc).toFixed(2),
        preco_por_base: registro.preco_por_base,
        unidade_base: registro.unidade_base || 'un',
        tipo_origem: registro.tipo_origem,
        registrado_por: registro.registrado_por,
        data_registro: registro.data_registro || new Date().toISOString().split('T')[0]
      }]);

    if (error) throw error;
  }

  // --- CONSULTAS DE COMPRAS E DETALHES ---
  async getHistoricoCompras(): Promise<CompraFechada[]> {
    const { data, error } = await this.supabase
      .from('compras_fechadas')
      .select('*')
      .order('data_compra', { ascending: false })
      .order('criado_em', { ascending: false });

    if (error) throw error;
    return data || [];
  }

  // Excluir cupom fechado e todos os seus itens do histórico (em cascata)
  async excluirCompraFechada(compraId: string): Promise<void> {
    // 1. Remove os itens atrelados a esta compra
    await this.supabase
      .from('historico_precos')
      .delete()
      .eq('compra_id', compraId);

    // 2. Remove o cabeçalho da compra
    const { error } = await this.supabase
      .from('compras_fechadas')
      .delete()
      .eq('id', compraId);

    if (error) throw error;
  }

  // Buscar todas as marcas cadastradas para autocomplete
  async getMarcasRegistradas(): Promise<string[]> {
    const { data } = await this.supabase
      .from('historico_precos')
      .select('marca')
      .not('marca', 'is', null)
      .neq('marca', '');

    if (!data) return [];
    const marcasUnicas = Array.from(new Set(data.map(d => d.marca.trim().toUpperCase())));
    return marcasUnicas.sort();
  }

  async getItensDaCompra(compraId: string): Promise<RegistroPreco[]> {
    const { data, error } = await this.supabase
      .from('historico_precos')
      .select('*')
      .eq('compra_id', compraId)
      .order('produto_nome');

    if (error) throw error;
    return data || [];
  }

  // --- CONSULTA PARA O DASHBOARD ---
  async getHistoricoPrecosPorProduto(produtoNome: string): Promise<RegistroPreco[]> {
    const { data, error } = await this.supabase
      .from('historico_precos')
      .select('*')
      .ilike('produto_nome', `%${produtoNome}%`)
      .order('data_registro', { ascending: true });

    if (error) throw error;
    return data || [];
  }
}