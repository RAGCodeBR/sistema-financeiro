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

// This independent preview is loaded only by Vite DEV. It never connects to
// Supabase, bypasses a real login or appears in the production routing.
export default function NfsePreview() {
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
          <Nfse storageScope="local-preview" />
        </div>
      </main>
    </div>
  );
}
