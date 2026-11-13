import {
  BarChart3,
  Building2,
  CreditCard,
  FileText,
  LayoutDashboard,
  Menu,
  ReceiptText,
  Tag,
  Wallet,
} from "lucide-react";
import Nfse from "./Nfse";
import { useState } from "react";
import { emptyNfseWorkspace } from "../lib/nfseDrafts";
import type {
  NfseFiscalState,
  NfseFiscalService,
} from "../lib/nfseFiscalRemote";

// This independent preview is loaded only by Vite DEV. It never connects to
// Supabase, bypasses a real login or appears in the production routing.
export default function NfsePreview() {
  const [demoService] = useState<NfseFiscalService>(() => {
    const { version: _, drafts: __, ...config } = emptyNfseWorkspace();
    let state: NfseFiscalState = {
      config,
      configRevision: 1,
      drafts: [],
      emissions: [],
      connection: null,
      canConfigure: true,
      canIssue: true,
      environment: 2,
      productionEnabled: false,
    };
    return {
      load: async () => structuredClone(state),
      execute: async (data) => {
        if (data.action === "config") {
          state = {
            ...state,
            config: data.config as typeof config,
            configRevision: state.configRevision + 1,
          };
        } else if (data.action === "draft") {
          const d = data.draft as NfseFiscalState["drafts"][number]["payload"];
          const old = state.drafts.find((x) => x.payload.id === d.id);
          state = {
            ...state,
            drafts: [
              { payload: d, revision: (old?.revision || 0) + 1 },
              ...state.drafts.filter((x) => x.payload.id !== d.id),
            ],
          };
        } else if (data.action === "remove")
          state = {
            ...state,
            drafts: state.drafts.filter((d) => d.payload.id !== data.id),
          };
        else
          throw new Error(
            "Esta é uma demonstração local. Consultas e envios fiscais só funcionam no sistema autenticado com o serviço de homologação ativado.",
          );
        return structuredClone(state);
      },
      download: async () => {
        throw new Error("A demonstração não emite documentos fiscais.");
      },
    };
  });
  const homologation =
    new URLSearchParams(location.search).get("homologacao") === "1";
  const navigation = [
    ["Dashboard", LayoutDashboard],
    ["Lançamentos", ReceiptText],
    ["Contas", Wallet],
    ["Cartões e faturas", CreditCard],
    ["NFS-e", FileText],
    ["Plano de contas", Tag],
    ["Fornecedores/clientes", Building2],
    ["Notas da equipe", FileText],
    ["Relatórios", BarChart3],
    ["Usuários", Menu],
  ] as const;
  return (
    <div className="nf-preview">
      <aside className="nf-preview-sidebar">
        <img
          src={`${import.meta.env.BASE_URL}fincore-logo-transparent.png`}
          alt="Fincore"
        />
        <p>Gestão financeira</p>
        <nav aria-label="Visualização do menu do sistema">
          {navigation.map(([name, Icon]) => (
            <span
              key={name}
              className={name === "NFS-e" ? "active" : ""}
              aria-current={name === "NFS-e" ? "page" : undefined}
            >
              <Icon />
              {name}
            </span>
          ))}
        </nav>
      </aside>
      <main className="nf-preview-main">
        <header className="nf-preview-header">
          <div>
            <b>NFS-e</b>
            <small>Notas fiscais de serviço</small>
          </div>
          <span>Visualização local</span>
        </header>
        <div className="nf-preview-content">
          {homologation && (
            <p className="nf-alert">
              Demonstração local da nova tela. Os dados desta prévia ficam
              apenas na memória. Nenhuma conexão ou emissão fiscal será
              realizada.
            </p>
          )}
          <Nfse
            storageScope="local-preview"
            fiscalService={homologation ? demoService : undefined}
          />
        </div>
      </main>
    </div>
  );
}
