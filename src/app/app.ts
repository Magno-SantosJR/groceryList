import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from './services/supabase.service';
import { CompraFechada, ItemLista, Produto, RegistroPreco } from './models/market.model';

interface ItemCarrinho extends ItemLista {
  selecionado: boolean;
  marcaComprada: string;
  precoUnitario: number | null;
  desconto: number | null;
  itemExtra?: boolean;
}

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
  abaAtiva = signal<'lista' | 'pesquisa' | 'compras' | 'dashboard'>('lista');
  usuarioAtivo = signal<'Magno' | 'Francine'>('Magno');

  produtosCatalogo = signal<Produto[]>([]);
  itensLista = signal<ItemCarrinho[]>([]);
  carregando = signal<boolean>(false);
  salvando = signal<boolean>(false);

  // Categorias e Filtros Visuais
  categorias = ['Todas', 'Hortifrúti', 'Padaria', 'Carnes', 'Laticínios', 'Bebidas', 'Mercearia', 'Limpeza', 'Higiene'];
  categoriaSelecionada = signal<string>('Todas');
  termoBusca = signal<string>('');

  // Itens mais frequentes sugeridos com ícones rápidos
  itensFrequentes = [
    { nome: 'Pão Francês', categoria: 'Padaria', unidade: 'kg', embalagem: '285g', icone: '🥖' },
    { nome: 'Leite Integral', categoria: 'Laticínios', unidade: 'L', embalagem: '1L', icone: '🥛' },
    { nome: 'Ovos Brancos', categoria: 'Hortifrúti', unidade: 'un', embalagem: 'cx c/ 12 un', icone: '🥚' },
    { nome: 'Café Tradicional', categoria: 'Mercearia', unidade: 'un', embalagem: '500g', icone: '☕' },
    { nome: 'Banana Prata', categoria: 'Hortifrúti', unidade: 'kg', embalagem: '1kg', icone: '🍌' },
    { nome: 'Arroz Branco', categoria: 'Mercearia', unidade: 'un', embalagem: '5kg', icone: '🍚' },
    { nome: 'Papel Higiênico', categoria: 'Higiene', unidade: 'un', embalagem: 'pct c/ 12 un', icone: '🧻' }
  ];

  opcoesEmbalagens = signal<string[]>([
    '500g', '700g', '1kg', '5kg',
    '350ml', '900ml', '1L', '2L',
    'pct c/ 12 un', 'pct c/ 24 un', 'pct c/ 32 un', 'cx c/ 12 un'
  ]);

  opcoesMarcas = signal<string[]>([
    'SADIA', 'PERDIGAO', 'SEARA', 'PIRACANJUBA', 'TIROL', 
    'MELITA', 'PILAO', 'BRAHMA', 'PETRA', 'COCA-COLA', 'PEPSI', 
    'NESTLE', 'DANONE', 'VITAMILK', 'KRAFT', 'HEINZ', 'AMBEV', 
    'ANGELONI', 'GIASSI', 'BISTEK', 'KOCH'
  ]);

  // Controlo do modal/painel de adição detalhada
  mostrarModalNovoItem = signal<boolean>(false);
  itemEmEdicao = signal<ItemCarrinho | null>(null);
  novoProdutoNome = '';
  novaCategoria = 'Geral';
  novaQuantidade: number | null = 1;
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
  extraQtd: number | null = 1;
  extraPreco: number | null = null;
  extraDesconto: number | null = null;
  extraMarca = '';
  extraEmbalagem = '';

  // Pesquisa / Folheto
  pesquisaProdutoNome = '';
  pesquisaSupermercado = 'Koch';
  pesquisaPreco: number | null = null;
  pesquisaDesconto: number | null = null;
  pesquisaMarca = '';
  pesquisaEmbalagem = '';
  pesquisaData = new Date().toISOString().split('T')[0];
  pesquisaOrigem: 'propaganda' | 'compra' = 'compra';

  // Lançamento de Nota Fiscal / Compra Antiga Completa
  compraAntigaMercado = 'Koch';
  compraAntigaData = new Date().toISOString().split('T')[0];
  compraAntigaItens = signal<ItemCupomAntigo[]>([]);

  notaNome = '';
  notaMarca = '';
  notaEmbalagem = '';
  notaQtd: number | null = 1;
  notaPrecoUnitario: number | null = null;
  notaDescontoTotal: number | null = null;

  totalCupomAntigo = computed(() => {
    return this.compraAntigaItens().reduce((sum, item) => sum + item.total_liquido, 0);
  });

  // Total do Carrinho
  totalCompra = computed(() => {
    return this.itensLista()
      .filter(item => item.selecionado)
      .reduce((acumulado, item) => {
        const unit = Number(item.precoUnitario) || 0;
        const desconto = Number(item.desconto) || 0;
        const precoReal = Math.max(0, unit - desconto);
        return acumulado + (precoReal * item.quantidade);
      }, 0);
  });

  // Itens da Lista Filtrados por Categoria e Busca
  itensFiltrados = computed(() => {
    let lista = this.itensLista();
    const cat = this.categoriaSelecionada();
    const busca = this.termoBusca().toLowerCase().trim();

    if (cat !== 'Todas') {
      lista = lista.filter(i => (i.categoria || 'Geral').toLowerCase() === cat.toLowerCase());
    }

    if (busca) {
      lista = lista.filter(i => i.produto_nome.toLowerCase().includes(busca));
    }

    return lista;
  });

  // Frequentes Filtrados pelo termo de pesquisa ou categoria atual
  itensFrequentesFiltrados = computed(() => {
    const cat = this.categoriaSelecionada();
    if (cat === 'Todas') return this.itensFrequentes;
    return this.itensFrequentes.filter(i => i.categoria.toUpperCase() === cat.toUpperCase());
  });

  // Histórico de Compras Fechadas & Detalhes do Cupão
  historicoCompras = signal<CompraFechada[]>([]);
  compraSelecionada = signal<CompraFechada | null>(null);
  itensCompraDetalhe = signal<RegistroPreco[]>([]);
  carregandoDetalhe = signal<boolean>(false);

  // Dashboard & Análise
  periodoFiltro = signal<'mes' | 'trimestre' | 'semestre' | 'ano'>('mes');
  produtoConsultaGrafico = '';
  historicoEvolucaoProduto = signal<RegistroPreco[]>([]);

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
    this.carregarMarcas();

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

  async carregarMarcas() {
    try {
      const marcas = await this.supabaseService.getMarcasRegistradas();
      if (marcas && marcas.length > 0) {
        this.opcoesMarcas.update(atuais => Array.from(new Set([...atuais, ...marcas])));
      }
    } catch (err) {
      console.error('Erro ao buscar marcas:', err);
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
      console.error('Erro ao carregar compras:', err);
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

  registrarOpcaoMarca(texto: string) {
    const limpo = texto.trim().toUpperCase();
    if (!limpo) return;
    if (!this.opcoesMarcas().includes(limpo)) {
      this.opcoesMarcas.update(lista => [limpo, ...lista]);
    }
  }

  // Adicionar item frequente com apenas 1 clique
  async adicionarItemFrequente(item: typeof this.itensFrequentes[0]) {
    const existente = this.itensLista().find(i => i.produto_nome.toLowerCase() === item.nome.toLowerCase());
    if (existente) {
      this.alterarQuantidade(existente, 1);
      return;
    }

    try {
      await this.supabaseService.adicionarItemLista({
        produto_nome: item.nome.toUpperCase(),
        categoria: item.categoria,
        quantidade: item.unidade === 'kg' ? 0.5 : 1,
        unidade_medida: item.unidade,
        medida_embalagem: item.embalagem,
        adicionado_por: this.usuarioAtivo()
      });
      await this.carregarItensLista();
    } catch (err) {
      console.error('Erro ao adicionar item frequente:', err);
    }
  }

  // Alterar quantidade (+ / -) direto no card
  alterarQuantidade(item: ItemCarrinho, delta: number) {
    const novaQtd = +(Math.max(0.1, Number(item.quantidade) + delta)).toFixed(2);
    item.quantidade = novaQtd;
    if (item.id) {
      this.supabaseService.atualizarItemLista(item.id, { quantidade: novaQtd }).catch(console.error);
    }
  }

  abrirModalNovoItem(nomeSugerido = '') {
    this.itemEmEdicao.set(null);
    this.novoProdutoNome = (nomeSugerido || '').toUpperCase();
    this.novaCategoria = this.categoriaSelecionada() === 'Todas' ? 'Geral' : this.categoriaSelecionada();
    this.novaQuantidade = 1;
    this.novaUnidade = 'un';
    this.novaMarca = '';
    this.novaEmbalagem = '';
    this.mostrarModalNovoItem.set(true);
  }

  editarItemDaLista(item: ItemCarrinho) {
    this.itemEmEdicao.set(item);
    this.novoProdutoNome = item.produto_nome.toUpperCase();
    this.novaCategoria = item.categoria || 'Geral';
    this.novaQuantidade = item.quantidade;
    this.novaUnidade = item.unidade_medida || 'un';
    this.novaMarca = (item.marca_sugerida || '').toUpperCase();
    this.novaEmbalagem = item.medida_embalagem || '';
    this.mostrarModalNovoItem.set(true);
  }

  async salvarNovoItemModal() {
    const nomeLimpo = this.novoProdutoNome.trim().toUpperCase();
    if (!nomeLimpo || this.salvando()) return;

    const marcaLimpa = this.novaMarca.trim().toUpperCase();
    this.registrarOpcaoMarca(marcaLimpa);
    this.registrarOpcaoEmbalagem(this.novaEmbalagem);

    this.salvando.set(true);
    try {
      const editando = this.itemEmEdicao();
      if (editando && editando.id) {
        await this.supabaseService.atualizarItemLista(editando.id, {
          produto_nome: nomeLimpo,
          categoria: this.novaCategoria,
          quantidade: Number(this.novaQuantidade) || 1,
          unidade_medida: this.novaUnidade || 'un',
          medida_embalagem: this.novaEmbalagem.trim() || undefined,
          marca_sugerida: this.novaMarca.trim() || undefined
        });
      } else {
        await this.supabaseService.adicionarItemLista({
          produto_nome: nomeLimpo,
          categoria: this.novaCategoria,
          quantidade: Number(this.novaQuantidade) || 1,
          unidade_medida: this.novaUnidade || 'un',
          medida_embalagem: this.novaEmbalagem.trim() || undefined,
          marca_sugerida: this.novaMarca.trim() || undefined,
          adicionado_por: this.usuarioAtivo()
        });
      }

      this.mostrarModalNovoItem.set(false);
      this.salvando.set(false);
      this.termoBusca.set('');
      await this.carregarItensLista();
    } catch (err) {
      console.error('Erro ao adicionar produto:', err);
    }
  }

  adicionarItemExtraNoCarrinho() {
    const nome = this.extraNome.trim().toUpperCase();
    if (!nome) return;

    const marca = this.extraMarca.trim().toUpperCase();
    this.registrarOpcaoMarca(marca);
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
      marcaComprada: marca,
      precoUnitario: Number(this.extraPreco) || 0,
      desconto: Number(this.extraDesconto) || 0,
      itemExtra: true
    };

    this.itensLista.update(lista => [novoExtra, ...lista]);
    this.extraNome = '';
    this.extraQtd = 1;
    this.extraPreco = null;
    this.extraDesconto = null;
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

  obterReferencia(precoUnitario: number | null, desconto: number | null, embalagem?: string, qtd?: number) {
    const final = Math.max(0, (precoUnitario || 0) - (desconto || 0));
    return calcularPrecoBase(final, embalagem || '', qtd);
  }

  async finalizarCompra() {
    if(this.salvando()) return;
    const selecionados = this.itensLista().filter(item => item.selecionado);
    if (selecionados.length === 0) {
      alert('Selecione pelo menos um item comprado antes de finalizar.');
      return;
    }

    this.salvando.set(true);
    try {
      const itensFormatados = selecionados.map(item => {
        const precoUnit = Number(item.precoUnitario) || 0;
        const desc = Number(item.desconto) || 0;
        const ref = calcularPrecoBase(
          Math.max(0, precoUnit - desc),
          item.medida_embalagem || '',
          item.quantidade
        );

        return {
          itemListaId: item.itemExtra ? undefined : item.id,
          produto_nome: item.produto_nome.toUpperCase(),
          categoria: item.categoria,
          marca: (item.marcaComprada || '').toUpperCase(),
          medida_embalagem: item.medida_embalagem,
          quantidade: item.quantidade,
          preco_unitario: precoUnit,
          desconto: desc,
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
    } finally {
      this.salvando.set(false);
    }
  }

  // --- Lançamento de Nota Fiscal Completa ---
  adicionarItemAoCupomAntigo() {
    const nome = this.notaNome.trim().toUpperCase();
    const unitario = Number(this.notaPrecoUnitario) || 0;

    if (!nome || unitario <= 0) {
      alert('Informe ao menos o Nome e o Preço Unitário.');
      return;
    }

    const qtd = Number(this.notaQtd) || 1;
    const descTotal = Number(this.notaDescontoTotal) || 0;
    const totalLiquido = +(Math.max(0, (unitario * qtd) - descTotal)).toFixed(2);
    const marca = this.notaMarca.trim().toUpperCase();

    this.registrarOpcaoMarca(marca);
    this.registrarOpcaoEmbalagem(this.notaEmbalagem);

    const novoItem: ItemCupomAntigo = {
      produto_nome: nome,
      marca: marca,
      medida_embalagem: this.notaEmbalagem.trim(),
      quantidade: qtd,
      preco_unitario: unitario,
      desconto_total: descTotal,
      total_liquido: totalLiquido
    };

    this.compraAntigaItens.update(itens => [...itens, novoItem]);
    this.notaNome = '';
    this.notaMarca = '';
    this.notaEmbalagem = '';
    this.notaQtd = 1;
    this.notaPrecoUnitario = null;
    this.notaDescontoTotal = null;
  }

  removerItemDoCupomAntigo(index: number) {
    this.compraAntigaItens.update(itens => itens.filter((_, i) => i !== index));
  }

  async salvarCupomAntigoCompleto() {
    if(this.salvando()) return;
    const itens = this.compraAntigaItens();
    if (itens.length === 0) {
      alert('Adicione pelo menos um item à compra.');
      return;
    }

    this.salvando.set(true);
    try {
      const itensFormatados = itens.map(item => {
        const descontoPorUnidade = item.quantidade > 0 ? +(item.desconto_total / item.quantidade).toFixed(2) : 0;
        const precoRealUnit = +(item.preco_unitario - descontoPorUnidade).toFixed(2);
        const ref = calcularPrecoBase(precoRealUnit, item.medida_embalagem, item.quantidade);

        return {
          produto_nome: item.produto_nome.toUpperCase(),
          categoria: 'Geral',
          marca: item.marca.toUpperCase(),
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

      alert(`Compra de ${this.compraAntigaMercado} registada com sucesso!`);
      this.compraAntigaItens.set([]);
      await this.carregarCompras();
    } catch (err) {
      console.error('Erro ao salvar nota fiscal:', err);
      alert('Ocorreu um erro ao guardar o cupom.');
    } finally {
      this.salvando.set(false);
    }
  }

  async salvarPesquisaOuAvulso() {
    const nome = this.pesquisaProdutoNome.trim();
    const preco = Number(this.pesquisaPreco) || 0;

    if (!nome || preco <= 0) {
      alert('Preencha o Nome do Produto e o Preço.');
      return;
    }

    const marca = this.pesquisaMarca.trim().toUpperCase();
    const desc = Number(this.pesquisaDesconto) || 0;

    this.registrarOpcaoMarca(marca);
    this.registrarOpcaoEmbalagem(this.pesquisaEmbalagem);

    const ref = calcularPrecoBase(
      Math.max(0, preco - desc),
      this.pesquisaEmbalagem
    );

    try {
      await this.supabaseService.registrarPrecoAvulso({
        produto_nome: nome,
        marca: marca,
        medida_embalagem: this.pesquisaEmbalagem.trim(),
        supermercado: this.pesquisaSupermercado,
        preco_unitario: preco,
        desconto: desc,
        preco_por_base: ref.precoBase,
        unidade_base: ref.unidadeBase,
        tipo_origem: this.pesquisaOrigem,
        registrado_por: this.usuarioAtivo(),
        data_registro: this.pesquisaData
      });

      alert(`Oferta registada com sucesso!`);
      this.pesquisaProdutoNome = '';
      this.pesquisaPreco = 0;
      this.pesquisaDesconto = 0;
      this.pesquisaMarca = '';
      this.pesquisaEmbalagem = '';
    } catch (err) {
      console.error('Erro ao registar oferta:', err);
      alert('Ocorreu um erro ao guardar a oferta.');
    } finally {
      this.salvando.set(false);
    }
  }

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

  async excluirCupom(compra: CompraFechada) {
    if (!confirm(`Deseja realmente excluir a compra de ${compra.supermercado} em ${compra.data_compra}?`)) {
      return;
    }

    if (this.salvando()) return;
    this.salvando.set(true);

    try {
      await this.supabaseService.excluirCompraFechada(compra.id);
      this.fecharDetalhesCompra();
      await this.carregarCompras();
      alert('Cupom excluído com sucesso!');
    } catch (err) {
      console.error('Erro ao excluir cupom:', err);
      alert('Ocorreu um erro ao excluir o cupom.');
    } finally {
      this.salvando.set(false);
    }
  }

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
}