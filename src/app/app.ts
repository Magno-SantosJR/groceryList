import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from './services/supabase.service';
import { CompraFechada, ItemLista, Produto, RegistroPreco } from './models/market.model';

interface ItemCarrinho extends ItemLista {
  selecionado: boolean;
  marcaComprada: string;
  precoUnitario: number;
  desconto: number;
  itemExtra?: boolean;
}

// Modelo para montar itens do cupom antigo
interface ItemCupomAntigo {
  produto_nome: string;
  marca: string;
  medida_embalagem: string;
  quantidade: number;
  preco_unitario: number;
  desconto_total: number;
  total_liquido: number;
}

export function calcularPrecoBase(
  precoPago: number,
  embalagem: string,
  qtdPesada?: number
): { precoBase: number; unidadeBase: string; pesoLiquido: number } {
  const preco = Number(precoPago) || 0;
  if (preco <= 0) return { precoBase: 0, unidadeBase: 'un', pesoLiquido: 1 };

  const emb = (embalagem || '').toLowerCase().trim();

  if (qtdPesada && qtdPesada > 0) {
    const pesoKg = qtdPesada > 10 ? qtdPesada / 1000 : qtdPesada;
    return { precoBase: +(preco / pesoKg).toFixed(2), unidadeBase: 'kg', pesoLiquido: pesoKg };
  }

  const matchGramas = emb.match(/(\d+([.,]\d+)?)\s*g/);
  if (matchGramas) {
    const pesoKg = parseFloat(matchGramas[1].replace(',', '.')) / 1000;
    if (pesoKg > 0) return { precoBase: +(preco / pesoKg).toFixed(2), unidadeBase: 'kg', pesoLiquido: pesoKg };
  }

  const matchKg = emb.match(/(\d+([.,]\d+)?)\s*kg/);
  if (matchKg) {
    const pesoKg = parseFloat(matchKg[1].replace(',', '.'));
    if (pesoKg > 0) return { precoBase: +(preco / pesoKg).toFixed(2), unidadeBase: 'kg', pesoLiquido: pesoKg };
  }

  const matchMl = emb.match(/(\d+([.,]\d+)?)\s*ml/);
  if (matchMl) {
    const volumeL = parseFloat(matchMl[1].replace(',', '.')) / 1000;
    if (volumeL > 0) return { precoBase: +(preco / volumeL).toFixed(2), unidadeBase: 'L', pesoLiquido: volumeL };
  }

  const matchLitro = emb.match(/(\d+([.,]\d+)?)\s*(l|litro|litros)/);
  if (matchLitro) {
    const volumeL = parseFloat(matchLitro[1].replace(',', '.'));
    if (volumeL > 0) return { precoBase: +(preco / volumeL).toFixed(2), unidadeBase: 'L', pesoLiquido: volumeL };
  }

  const matchUn = emb.match(/(\d+)\s*(un|unidades|rolos|ovos)?/);
  if (matchUn) {
    const unidades = parseInt(matchUn[1], 10);
    if (unidades > 1) return { precoBase: +(preco / unidades).toFixed(2), unidadeBase: 'un', pesoLiquido: unidades };
  }

  return { precoBase: preco, unidadeBase: 'un', pesoLiquido: 1 };
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnInit {
  // Navegação entre as 4 abas
  abaAtiva = signal<'lista' | 'pesquisa' | 'compras' | 'dashboard'>('lista');
  usuarioAtivo = signal<'Magno' | 'Francine'>('Magno');

  produtosCatalogo = signal<Produto[]>([]);
  itensLista = signal<ItemCarrinho[]>([]);
  carregando = signal<boolean>(false);

  // Lista dinâmica de embalagens
  opcoesEmbalagens = signal<string[]>([
    '500g', '700g', '1kg', '5kg',
    '350ml', '900ml', '1L', '2L',
    'pct c/ 12 un', 'pct c/ 24 un', 'pct c/ 32 un', 'cx c/ 12 un'
  ]);

  // Formulário: Adicionar à Lista
  novoProdutoNome = '';
  novaQuantidade = 1;
  novaUnidade = 'un';
  novaMarca = '';
  novaEmbalagem = '';

  // Modo no Mercado
  modoCompras = signal<boolean>(false);
  supermercadoAtual = 'Koch';
  supermercadosDisponiveis = ['Koch', 'Giassi', 'Bistek', 'Angeloni', 'Fort Atacadista', 'Outro'];
  dataCompraAtual = new Date().toISOString().split('T')[0];

  // Item Extra no Carrinho
  extraNome = '';
  extraQtd = 1;
  extraPreco = 0;
  extraDesconto = 0;
  extraMarca = '';
  extraEmbalagem = '';

  // Pesquisa / Oferta
  pesquisaProdutoNome = '';
  pesquisaSupermercado = 'Koch';
  pesquisaPreco = 0;
  pesquisaDesconto = 0;
  pesquisaMarca = '';
  pesquisaEmbalagem = '';
  pesquisaData = new Date().toISOString().split('T')[0];
  pesquisaOrigem: 'propaganda' | 'compra' = 'propaganda';

  // --- LANÇAMENTO DE COMPRA ANTIGA / NOTA FISCAL COMPLETA ---
  compraAntigaMercado = 'Koch';
  compraAntigaData = new Date().toISOString().split('T')[0];
  compraAntigaItens = signal<ItemCupomAntigo[]>([]);

  // Formulário do item atual da nota
  notaNome = '';
  notaMarca = '';
  notaEmbalagem = '350ml';
  notaQtd = 1;
  notaPrecoUnitario = 0;
  notaDescontoTotal = 0; // Desconto total do item na nota (ex: 2.40 nas 6 cervejas)

  // Total do Carrinho
  totalCompra = computed(() => {
    return this.itensLista()
      .filter(item => item.selecionado)
      .reduce((acumulado, item) => {
        const precoReal = Math.max(0, (item.precoUnitario || 0) - (item.desconto || 0));
        return acumulado + (precoReal * item.quantidade);
      }, 0);
  });

  // Total do cupom em digitação
  totalCupomAntigo = computed(() => {
    return this.compraAntigaItens().reduce((sum, item) => sum + item.total_liquido, 0);
  });

  // Histórico de Compras Fechadas & Detalhes do Cupom
  historicoCompras = signal<CompraFechada[]>([]);
  compraSelecionada = signal<CompraFechada | null>(null);
  itensCompraDetalhe = signal<RegistroPreco[]>([]);
  carregandoDetalhe = signal<boolean>(false);

  // Dashboard & Análise
  periodoFiltro = signal<'mes' | 'trimestre' | 'semestre' | 'ano'>('mes');
  produtoConsultaGrafico = '';
  historicoEvolucaoProduto = signal<RegistroPreco[]>([]);

  // Agregações de Dashboard calculadas
  comprasFiltradasPorPeriodo = computed(() => {
    const compras = this.historicoCompras();
    const agora = new Date();
    const limite = new Date();

    if (this.periodoFiltro() === 'mes') {
      limite.setMonth(agora.getMonth() - 1);
    } else if (this.periodoFiltro() === 'trimestre') {
      limite.setMonth(agora.getMonth() - 3);
    } else if (this.periodoFiltro() === 'semestre') {
      limite.setMonth(agora.getMonth() - 6);
    } else if (this.periodoFiltro() === 'ano') {
      limite.setFullYear(agora.getFullYear() - 1);
    }

    return compras.filter(c => new Date(c.data_compra) >= limite);
  });

  totalGastoPeriodo = computed(() => {
    return this.comprasFiltradasPorPeriodo().reduce((sum, c) => sum + Number(c.valor_total), 0);
  });

  gastosPorMercado = computed(() => {
    const mapa = new Map<string, number>();
    for (const c of this.comprasFiltradasPorPeriodo()) {
      mapa.set(c.supermercado, (mapa.get(c.supermercado) || 0) + Number(c.valor_total));
    }
    return Array.from(mapa.entries()).map(([mercado, valor]) => ({ mercado, valor }));
  });

  constructor(private supabaseService: SupabaseService) {}

  async ngOnInit() {
    await this.carregarCatalogo();
    await this.carregarItensLista();
    await this.carregarCompras();

    this.supabaseService.ouvirListaTempoReal(() => {
      this.carregarItensLista();
    });
  }

  async carregarCatalogo() {
    try {
      const produtos = await this.supabaseService.getProdutos();
      this.produtosCatalogo.set(produtos);
    } catch (err) {
      console.error('Erro ao carregar catálogo:', err);
    }
  }

  async carregarItensLista() {
    try {
      this.carregando.set(true);
      const itens = await this.supabaseService.getItensFaltantes();
      const extrasLocais = this.itensLista().filter(i => i.itemExtra);

      const itensMapeados: ItemCarrinho[] = itens.map(item => {
        const anterior = this.itensLista().find(i => i.id === item.id);
        return {
          ...item,
          selecionado: anterior ? anterior.selecionado : false,
          marcaComprada: anterior ? anterior.marcaComprada : (item.marca_sugerida || ''),
          precoUnitario: anterior ? anterior.precoUnitario : 0,
          desconto: anterior ? anterior.desconto : 0
        };
      });

      this.itensLista.set([...itensMapeados, ...extrasLocais]);
    } catch (err) {
      console.error('Erro ao carregar lista de compras:', err);
    } finally {
      this.carregando.set(false);
    }
  }

  async carregarCompras() {
    try {
      const compras = await this.supabaseService.getHistoricoCompras();
      this.historicoCompras.set(compras);
    } catch (err) {
      console.error('Erro ao carregar histórico de compras:', err);
    }
  }

  selecionarUsuario(usuario: 'Magno' | 'Francine') {
    this.usuarioAtivo.set(usuario);
  }

  registrarOpcaoEmbalagem(texto: string) {
    const limpo = texto.trim();
    if (!limpo) return;
    if (!this.opcoesEmbalagens().includes(limpo)) {
      this.opcoesEmbalagens.update(lista => [limpo, ...lista]);
    }
  }

  async adicionarItem() {
    const nomeLimpo = this.novoProdutoNome.trim();
    if (!nomeLimpo) return;

    this.registrarOpcaoEmbalagem(this.novaEmbalagem);

    try {
      const encontrado = this.produtosCatalogo().find(
        p => p.nome.toLowerCase() === nomeLimpo.toLowerCase()
      );

      await this.supabaseService.adicionarItemLista({
        produto_id: encontrado?.id,
        produto_nome: encontrado ? encontrado.nome : nomeLimpo,
        categoria: encontrado?.categoria || 'Geral',
        quantidade: this.novaQuantidade || 1,
        unidade_medida: this.novaUnidade || 'un',
        medida_embalagem: this.novaEmbalagem.trim() || undefined,
        marca_sugerida: this.novaMarca.trim() || undefined,
        adicionado_por: this.usuarioAtivo()
      });

      this.novoProdutoNome = '';
      this.novaQuantidade = 1;
      this.novaMarca = '';
      this.novaEmbalagem = '';
      await this.carregarItensLista();
    } catch (err) {
      console.error('Erro ao adicionar produto:', err);
    }
  }

  adicionarItemExtraNoCarrinho() {
    const nome = this.extraNome.trim();
    if (!nome) return;

    this.registrarOpcaoEmbalagem(this.extraEmbalagem);

    const novoExtra: ItemCarrinho = {
      produto_nome: nome,
      categoria: 'Geral',
      quantidade: Number(this.extraQtd) || 1,
      unidade_medida: 'un',
      medida_embalagem: this.extraEmbalagem.trim(),
      adicionado_por: this.usuarioAtivo(),
      status: 'pendente',
      selecionado: true,
      marcaComprada: this.extraMarca.trim(),
      precoUnitario: Number(this.extraPreco) || 0,
      desconto: Number(this.extraDesconto) || 0,
      itemExtra: true
    };

    this.itensLista.update(lista => [novoExtra, ...lista]);

    this.extraNome = '';
    this.extraQtd = 1;
    this.extraPreco = 0;
    this.extraDesconto = 0;
    this.extraMarca = '';
    this.extraEmbalagem = '';
  }

  async removerItem(item: ItemCarrinho) {
    if (item.itemExtra) {
      this.itensLista.update(lista => lista.filter(i => i !== item));
      return;
    }
    if (!item.id) return;
    try {
      await this.supabaseService.removerItemLista(item.id);
      await this.carregarItensLista();
    } catch (err) {
      console.error('Erro ao remover produto:', err);
    }
  }

  alternarModoCompras() {
    this.modoCompras.update(valor => !valor);
  }

  obterReferencia(precoUnitario: number, desconto: number, embalagem?: string, qtd?: number) {
    const final = Math.max(0, (precoUnitario || 0) - (desconto || 0));
    return calcularPrecoBase(final, embalagem || '', qtd);
  }

  async finalizarCompra() {
    const selecionados = this.itensLista().filter(item => item.selecionado);
    if (selecionados.length === 0) {
      alert('Selecione pelo menos um item comprado antes de finalizar.');
      return;
    }

    try {
      const itensFormatados = selecionados.map(item => {
        const ref = calcularPrecoBase(
          Math.max(0, (item.precoUnitario || 0) - (item.desconto || 0)),
          item.medida_embalagem || '',
          item.quantidade
        );

        return {
          itemListaId: item.itemExtra ? undefined : item.id,
          produto_nome: item.produto_nome,
          categoria: item.categoria,
          marca: item.marcaComprada,
          medida_embalagem: item.medida_embalagem,
          quantidade: item.quantidade,
          preco_unitario: Number(item.precoUnitario) || 0,
          desconto: Number(item.desconto) || 0,
          preco_por_base: ref.precoBase,
          unidade_base: ref.unidadeBase
        };
      });

      await this.supabaseService.registrarCompraConcluida(
        {
          supermercado: this.supermercadoAtual,
          data_compra: this.dataCompraAtual,
          comprado_por: this.usuarioAtivo()
        },
        itensFormatados
      );

      this.modoCompras.set(false);
      await this.carregarItensLista();
      await this.carregarCompras();
      alert(`Compra de R$ ${this.totalCompra().toFixed(2)} guardada com sucesso!`);
    } catch (err) {
      console.error('Erro ao concluir compra:', err);
      alert('Erro ao gravar a compra.');
    }
  }

  async salvarPesquisaOuAvulso() {
    const nome = this.pesquisaProdutoNome.trim();
    if (!nome || !this.pesquisaPreco) {
      alert('Preencha o Nome do Produto e o Preço.');
      return;
    }

    this.registrarOpcaoEmbalagem(this.pesquisaEmbalagem);

    const ref = calcularPrecoBase(
      Math.max(0, this.pesquisaPreco - (this.pesquisaDesconto || 0)),
      this.pesquisaEmbalagem
    );

    try {
      await this.supabaseService.registrarPrecoAvulso({
        produto_nome: nome,
        marca: this.pesquisaMarca.trim(),
        medida_embalagem: this.pesquisaEmbalagem.trim(),
        supermercado: this.pesquisaSupermercado,
        preco_unitario: Number(this.pesquisaPreco),
        desconto: Number(this.pesquisaDesconto) || 0,
        preco_por_base: ref.precoBase,
        unidade_base: ref.unidadeBase,
        tipo_origem: this.pesquisaOrigem,
        registrado_por: this.usuarioAtivo(),
        data_registro: this.pesquisaData
      });

      alert(`Preço registado com sucesso!`);
      this.pesquisaProdutoNome = '';
      this.pesquisaPreco = 0;
      this.pesquisaDesconto = 0;
      this.pesquisaMarca = '';
      this.pesquisaEmbalagem = '';
    } catch (err) {
      console.error('Erro ao registar pesquisa:', err);
      alert('Ocorreu um erro ao guardar o preço.');
    }
  }

  // --- Visualização do Cupom Detalhado ---
  async abrirDetalhesCompra(compra: CompraFechada) {
    this.compraSelecionada.set(compra);
    this.carregandoDetalhe.set(true);
    try {
      const itens = await this.supabaseService.getItensDaCompra(compra.id);
      this.itensCompraDetalhe.set(itens);
    } catch (err) {
      console.error('Erro ao carregar itens da compra:', err);
    } finally {
      this.carregandoDetalhe.set(false);
    }
  }

  fecharDetalhesCompra() {
    this.compraSelecionada.set(null);
    this.itensCompraDetalhe.set([]);
  }

  // --- Consulta de Evolução no Dashboard ---
  async consultarEvolucaoProduto() {
    const nome = this.produtoConsultaGrafico.trim();
    if (!nome) return;

    try {
      const registros = await this.supabaseService.getHistoricoPrecosPorProduto(nome);
      this.historicoEvolucaoProduto.set(registros);
    } catch (err) {
      console.error('Erro ao consultar evolução:', err);
    }
  }

  // Adicionar linha ao cupom antigo
  adicionarItemAoCupomAntigo() {
    const nome = this.notaNome.trim();
    if (!nome || !this.notaPrecoUnitario) {
      alert('Informe ao menos o Nome e o Preço Unitário.');
      return;
    }

    const qtd = Number(this.notaQtd) || 1;
    const unitario = Number(this.notaPrecoUnitario) || 0;
    const descTotal = Number(this.notaDescontoTotal) || 0;
    const totalLiquido = +(Math.max(0, (unitario * qtd) - descTotal)).toFixed(2);

    this.registrarOpcaoEmbalagem(this.notaEmbalagem);

    const novoItem: ItemCupomAntigo = {
      produto_nome: nome,
      marca: this.notaMarca.trim(),
      medida_embalagem: this.notaEmbalagem.trim(),
      quantidade: qtd,
      preco_unitario: unitario,
      desconto_total: descTotal,
      total_liquido: totalLiquido
    };

    this.compraAntigaItens.update(itens => [...itens, novoItem]);

    // Limpa campos para o próximo item
    this.notaNome = '';
    this.notaMarca = '';
    this.notaEmbalagem = '';
    this.notaQtd = 1;
    this.notaPrecoUnitario = 0;
    this.notaDescontoTotal = 0;
  }

  removerItemDoCupomAntigo(index: number) {
    this.compraAntigaItens.update(itens => itens.filter((_, i) => i !== index));
  }

  // Gravar a compra fechada no Supabase
  async salvarCupomAntigoCompleto() {
    const itens = this.compraAntigaItens();
    if (itens.length === 0) {
      alert('Adicione pelo menos um item à compra.');
      return;
    }

    try {
      const itensFormatados = itens.map(item => {
        const descontoPorUnidade = item.quantidade > 0 ? +(item.desconto_total / item.quantidade).toFixed(2) : 0;
        const precoRealUnit = +(item.preco_unitario - descontoPorUnidade).toFixed(2);
        const ref = calcularPrecoBase(precoRealUnit, item.medida_embalagem);

        return {
          produto_nome: item.produto_nome,
          categoria: 'Geral',
          marca: item.marca,
          medida_embalagem: item.medida_embalagem,
          quantidade: item.quantidade,
          preco_unitario: item.preco_unitario,
          desconto: descontoPorUnidade,
          preco_por_base: ref.precoBase,
          unidade_base: ref.unidadeBase
        };
      });

      await this.supabaseService.registrarCompraConcluida(
        {
          supermercado: this.compraAntigaMercado,
          data_compra: this.compraAntigaData,
          comprado_por: this.usuarioAtivo()
        },
        itensFormatados
      );

      alert(`Compra de ${this.compraAntigaMercado} com ${itens.length} itens gravada com sucesso!`);
      this.compraAntigaItens.set([]);
      await this.carregarCompras();
    } catch (err) {
      console.error('Erro ao salvar compra antiga:', err);
      alert('Ocorreu um erro ao salvar o cupom.');
    }
  }
}