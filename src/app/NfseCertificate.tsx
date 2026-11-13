import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  AlertCircle,
  Check,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import type {
  NfseCertificateService,
  NfseCertificateStatus,
} from "../lib/nfseCertificate";

const date = (value: string) =>
  new Date(value).toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });

export default function NfseCertificate({
  issuerCnpj,
  service,
  canManage = false,
}: {
  issuerCnpj: string;
  service?: NfseCertificateService;
  canManage?: boolean;
}) {
  const [status, setStatus] = useState<NfseCertificateStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [replace, setReplace] = useState(false);
  const [removeConfirm, setRemoveConfirm] = useState(false);
  const [removeChecked, setRemoveChecked] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (service) void load();
  }, [service]);
  useEffect(() => {
    if (!canManage) {
      setPassword("");
      setFile(null);
      setReplace(false);
      setRemoveConfirm(false);
      if (input.current) input.current.value = "";
    }
  }, [canManage]);
  const current = status?.certificate;
  const mismatch = Boolean(
    status && issuerCnpj.replace(/\D/g, "") !== status.issuerCnpj,
  );
  const enabled = Boolean(
    status?.configured &&
      status.canManage &&
      canManage &&
      !mismatch &&
      !loading &&
      !busy,
  );
  const expired = Boolean(
    current && new Date(current.validUntil).getTime() <= Date.now(),
  );

  async function load() {
    if (!service) return;
    controller.current?.abort();
    const activeController = new AbortController();
    controller.current = activeController;
    setLoading(true);
    setError("");
    setPassword("");
    try {
      const result = await service.status(activeController.signal);
      if (alive.current) {
        setStatus(result);
        setReplace(false);
        setRemoveConfirm(false);
        setRemoveChecked(false);
      }
    } catch (error) {
      if (alive.current && !activeController.signal.aborted) {
        setStatus(null);
        setError(
          error instanceof Error
            ? error.message
            : "Não foi possível consultar o A1.",
        );
      }
    } finally {
      if (alive.current && controller.current === activeController)
        setLoading(false);
    }
  }
  function pick(next: File | null) {
    setPassword("");
    setError("");
    setNotice("");
    if (
      next &&
      (!/\.(pfx|p12)$/i.test(next.name) ||
        next.size === 0 ||
        next.size > 512 * 1024)
    ) {
      setFile(null);
      if (input.current) input.current.value = "";
      setError("Selecione um A1 .pfx ou .p12 de até 512 KB.");
      return;
    }
    setFile(next);
  }
  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!enabled || !service || !file || (current && !replace)) return;
    const sendingFile = file,
      sendingPassword = password,
      expectedId = current?.id || null;
    setPassword("");
    setFile(null);
    if (input.current) input.current.value = "";
    setBusy(true);
    setError("");
    setNotice("");
    controller.current = new AbortController();
    try {
      await service.upload(
        sendingFile,
        sendingPassword,
        expectedId,
        controller.current.signal,
      );
      if (!alive.current) return;
      setNotice(
        "A1 validado e armazenado com criptografia no servidor. A emissão fiscal continua pendente.",
      );
      await load();
    } catch (error) {
      if (alive.current) {
        setStatus(null);
        setError(
          error instanceof Error
            ? error.message
            : "Não foi possível cadastrar o A1. Atualize o status antes de tentar novamente.",
        );
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function remove() {
    if (!enabled || !service || !current || !removeChecked) return;
    setBusy(true);
    setError("");
    setNotice("");
    setPassword("");
    setFile(null);
    if (input.current) input.current.value = "";
    try {
      await service.remove(current.id);
      if (alive.current) {
        setNotice(
          "O certificado foi removido do cadastro ativo. Essa ação não revoga o A1 na autoridade certificadora.",
        );
        await load();
      }
    } catch (error) {
      if (alive.current) {
        setStatus(null);
        setError(
          error instanceof Error
            ? error.message
            : "Não foi possível remover o certificado.",
        );
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  return (
    <div className="nf-cert-manager">
      <div className="nf-certificate">
        <div className="nf-certificate-icon">
          <ShieldCheck />
        </div>
        <div>
          <span
            className={`nf-tag ${current && !expired ? "nf-tag-green" : "nf-tag-amber"}`}
          >
            {loading
              ? "Consultando servidor"
              : current
                ? expired
                  ? "Certificado vencido"
                  : "A1 cadastrado"
                : status?.configured
                  ? "Pronto para receber o A1"
                  : "Aguardando conexão segura"}
          </span>
          <h4>Certificado digital da empresa</h4>
          <p>
            O A1 é validado no servidor. A chave privada fica criptografada; a
            senha do arquivo não é salva. O certificado nunca é guardado nos
            rascunhos deste navegador.
          </p>
        </div>
      </div>
      {loading && (
        <div className="nf-cert-loading" role="status">
          <LoaderCircle /> Consultando o cadastro do certificado…
        </div>
      )}
      {!service && (
        <div className="nf-alert">
          <LockKeyhole />
          <span>
            Esta visualização é independente do servidor. O envio do certificado
            fica disponível no sistema autenticado após a ativação do serviço
            seguro.
          </span>
        </div>
      )}
      {error && (
        <div className="nf-alert nf-error" role="alert">
          <AlertCircle />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="nf-alert nf-success" role="status">
          <Check />
          <span>{notice}</span>
        </div>
      )}
      {status && !status.configured && (
        <div className="nf-alert">
          <LockKeyhole />
          <span>
            {status.message ||
              "A criptografia e as raízes de confiança precisam ser configuradas no servidor antes do envio."}
          </span>
        </div>
      )}
      {mismatch && (
        <div className="nf-alert nf-error" role="alert">
          <AlertCircle />
          <span>
            O CNPJ do formulário é diferente do emissor cadastrado no servidor.
            Confira o cadastro antes de enviar o A1.
          </span>
        </div>
      )}
      {current && (
        <>
          <div className="nf-cert-details">
            <div>
              <span>Titular</span>
              <b>{current.subject}</b>
            </div>
            <div>
              <span>CNPJ</span>
              <b>{current.cnpj}</b>
            </div>
            <div>
              <span>Autoridade certificadora</span>
              <b>{current.authority}</b>
            </div>
            <div>
              <span>Validade</span>
              <b>
                {date(current.validFrom)} a {date(current.validUntil)}
              </b>
            </div>
            <div>
              <span>Cadeia de confiança</span>
              <b>Verificada no cadastro</b>
            </div>
            <div>
              <span>Revogação</span>
              <b>
                {current.revocationStatus === "good"
                  ? "Conferida na última consulta"
                  : current.revocationStatus === "revoked"
                    ? "Certificado revogado"
                    : "Consulta pendente"}
              </b>
            </div>
          </div>
          <div className="nf-alert">
            <AlertCircle />
            <span>
              {current.revocationStatus === "good"
                ? "A revogação é conferida novamente antes de assinar ou transmitir uma DPS. A emissão em produção permanece bloqueada."
                : "Use o teste de conexão na homologação para conferir a revogação atual. O cadastro do A1 não autoriza a emissão de notas em produção."}
            </span>
          </div>
        </>
      )}
      {canManage && (
        <form className="nf-cert-form" onSubmit={upload} autoComplete="off">
          <div className="nf-grid nf-grid-two">
            <label className="nf-field">
              <span>Arquivo do certificado A1</span>
              <input
                ref={input}
                type="file"
                accept=".pfx,.p12"
                aria-label="Arquivo do certificado A1"
                disabled={!enabled}
                onChange={(event) => pick(event.target.files?.[0] || null)}
              />
            </label>
            <label className="nf-field">
              <span>Senha do certificado</span>
              <input
                type="password"
                aria-label="Senha do certificado"
                value={password}
                disabled={!enabled || !file}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                spellCheck={false}
                maxLength={256}
                placeholder="Senha do arquivo .pfx ou .p12"
              />
            </label>
          </div>
          <small className="nf-cert-hint">
            Arquivos .pfx ou .p12, até 512 KB. Não envie certificados ou senhas
            por mensagens.
          </small>
          {current && (
            <label className="nf-cert-confirm">
              <input
                type="checkbox"
                checked={replace}
                disabled={!enabled}
                onChange={(event) => setReplace(event.target.checked)}
              />{" "}
              Confirmo substituir o certificado atualmente cadastrado.
            </label>
          )}
          <div className="nf-cert-actions">
            <button
              type="submit"
              className="nf-button nf-primary"
              disabled={!enabled || !file || Boolean(current && !replace)}
            >
              {busy ? <LoaderCircle /> : <Upload />}
              {busy
                ? "Processando…"
                : current
                  ? "Validar e substituir A1"
                  : "Validar e cadastrar A1"}
            </button>
            {current && (
              <button
                type="button"
                className="nf-button"
                disabled={!enabled}
                onClick={() => {
                  setRemoveConfirm(!removeConfirm);
                  setRemoveChecked(false);
                }}
              >
                <Trash2 /> Remover certificado
              </button>
            )}
          </div>
        </form>
      )}
      {!canManage && service && (
        <div className="nf-alert">
          <LockKeyhole />
          <span>
            Somente um usuário Master pode cadastrar, substituir ou remover o
            certificado.
          </span>
        </div>
      )}
      {removeConfirm && (
        <div className="nf-cert-remove">
          <p>
            Remover o A1 do cadastro ativo impede seu uso pelo sistema. A
            revogação na autoridade certificadora é uma operação separada.
          </p>
          <label className="nf-cert-confirm">
            <input
              type="checkbox"
              checked={removeChecked}
              disabled={busy}
              onChange={(event) => setRemoveChecked(event.target.checked)}
            />{" "}
            Confirmo a remoção do certificado do sistema.
          </label>
          <div className="nf-cert-actions">
            <button
              type="button"
              className="nf-button"
              disabled={busy}
              onClick={() => setRemoveConfirm(false)}
            >
              Manter certificado
            </button>
            <button
              type="button"
              className="nf-button nf-danger"
              disabled={!enabled || !removeChecked}
              onClick={() => void remove()}
            >
              Confirmar remoção
            </button>
          </div>
        </div>
      )}
      {service && (
        <button
          type="button"
          className="nf-button nf-plain"
          disabled={loading || busy}
          onClick={() => {
            setFile(null);
            if (input.current) input.current.value = "";
            void load();
          }}
        >
          <RefreshCw /> Atualizar status do A1
        </button>
      )}
      <div className="nf-checklist">
        <div>
          <KeyRound />
          <span>
            <b>Arquivo e chave privada</b>
            <small>
              Senha, integridade, correspondência da chave e política A1
              verificadas no servidor.
            </small>
          </span>
        </div>
        <div>
          <ShieldCheck />
          <span>
            <b>Identidade e validade</b>
            <small>
              CNPJ do emissor, período de validade e cadeia ICP-Brasil
              conferidos.
            </small>
          </span>
        </div>
        <div>
          <LockKeyhole />
          <span>
            <b>Custódia e auditoria</b>
            <small>
              Criptografia no servidor, acesso restrito e histórico de cadastro,
              substituição e remoção.
            </small>
          </span>
        </div>
      </div>
    </div>
  );
}
