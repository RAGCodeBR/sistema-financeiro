import { useEffect, useRef, useState } from "react";
import {
  Download,
  RefreshCw,
  ShieldCheck,
  Send,
  FileCheck2,
  Pencil,
} from "lucide-react";
import type { NfseDraft } from "../lib/nfseDrafts";
import type {
  NfseFiscalService,
  NfseFiscalState,
  NfseEmission,
} from "../lib/nfseFiscalRemote";
import { fmt, parseMoney } from "./shared";
const labels: Record<string, string> = {
  preparing: "Preparando DPS",
  prepared: "DPS pronta para revisão",
  sending: "Envio em andamento — consultar",
  authorized: "Autorizada em homologação",
  rejected: "Rejeitada — revise e salve o rascunho",
  unknown: "Resultado pendente — consultar",
  failed: "Preparo não concluído",
  discarded: "DPS descartada antes do envio — revise e salve o rascunho",
};
export default function NfseHomologation({
  service,
  state,
  onChange,
  busy,
  onBusy,
  onError,
  onEditDraft,
}: {
  service: NfseFiscalService;
  state: NfseFiscalState;
  onChange: (state: NfseFiscalState) => void;
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onError: (error: string) => void;
  onEditDraft: (draft: NfseDraft) => void;
}) {
  const [selection, setSelection] = useState(""),
    [confirming, setConfirming] = useState<string | null>(null),
    [documentStatus, setDocumentStatus] = useState<{
      id: string;
      format: string;
      state: "loading" | "success" | "error";
      message: string;
      url?: string;
    } | null>(null);
  const documentUrl = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (documentUrl.current) URL.revokeObjectURL(documentUrl.current);
    },
    [],
  );
  const saved = state.drafts.find((d) => d.payload.id === selection),
    pending = state.emissions.find(
      (e) => e.draftId === selection && e.draftRevision === saved?.revision,
    );
  async function run(data: Record<string, unknown>) {
    onBusy(true);
    onError("");
    try {
      onChange(await service.execute(data));
      setConfirming(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : "A operação não foi concluída.");
      try {
        onChange(await service.load());
      } catch {
        /* preserve visible state */
      }
    } finally {
      onBusy(false);
    }
  }
  async function download(e: NfseEmission, format: "xml" | "pdf" | "mirror") {
    onBusy(true);
    onError("");
    setDocumentStatus({
      id: e.id,
      format,
      state: "loading",
      message:
        format === "pdf"
          ? "Consultando o DANFSe oficial…"
          : format === "mirror"
            ? "Gerando espelho de conferência a partir do XML autorizado…"
            : "Baixando XML…",
    });
    try {
      let result = await service.download(
        e.id,
        format === "mirror" ? "xml" : format,
      );
      if (format === "mirror") {
        if (e.status !== "authorized" || !e.accessKey)
          throw new Error(
            "O espelho exige uma NFS-e autorizada em homologação.",
          );
        const { readNfseMirror, createNfseMirrorPdf } = await import(
          "../lib/nfseMirror"
        );
        result = {
          blob: await createNfseMirrorPdf(
            readNfseMirror(await result.blob.text(), {
              accessKey: e.accessKey,
              dpsId: e.dpsId,
            }),
          ),
          filename: `ESPELHO-SEM-VALIDADE-FISCAL-DPS-${e.number}.pdf`,
        };
      }
      const url = URL.createObjectURL(result.blob),
        a = document.createElement("a");
      if (documentUrl.current) URL.revokeObjectURL(documentUrl.current);
      documentUrl.current = url;
      a.href = url;
      a.download = result.filename;
      document.body.append(a);
      a.click();
      a.remove();
      setDocumentStatus({
        id: e.id,
        format,
        state: "success",
        url: format === "xml" ? undefined : url,
        message:
          format === "mirror"
            ? "Espelho de conferência baixado. Abra o PDF nos downloads do navegador. Ele não substitui o DANFSe oficial."
            : "Download iniciado. Confira os downloads do navegador.",
      });
    } catch (e) {
      setDocumentStatus((previous) =>
        previous
          ? {
              ...previous,
              state: "error",
              message:
                (e instanceof Error ? e.message : "Documento indisponível.") +
                (format === "pdf"
                  ? " A nota continua autorizada. Você pode baixar o Espelho em PDF para conferência."
                  : ""),
            }
          : null,
      );
    } finally {
      onBusy(false);
    }
  }
  const connection = state.connection,
    fresh =
      connection?.validUntil && new Date(connection.validUntil) > new Date();
  return (
    <section
      className="nf-panel nf-homologation"
      aria-label="Homologação da emissão"
    >
      <header>
        <h3>
          <ShieldCheck />
          Homologação da emissão
        </h3>
        <p>
          Ambiente de testes · sem validade fiscal · emissão em produção
          bloqueada.
        </p>
      </header>
      <div className="nf-panel-body">
        <div className="nf-homologation-actions">
          <div>
            <b>
              {connection?.details.connected
                ? "Conexão nacional verificada"
                : "Conexão nacional ainda não verificada"}
            </b>
            <p>
              {connection
                ? `Certificado: ${connection.revocationStatus === "good" && fresh ? "revogação conferida" : "verificação precisa ser atualizada"}. Convênio: ${connection.eligible === true ? "adesão confirmada" : connection.eligible === false ? "sem adesão ao emissor nacional" : "aguardando confirmação"}.`
                : "O teste consulta a cadeia do A1 e os parâmetros de Santos no ambiente nacional."}
            </p>
          </div>
          {state.canConfigure && (
            <button
              className="nf-button"
              disabled={busy}
              onClick={() => run({ action: "connection" })}
            >
              <RefreshCw />
              Testar conexão
            </button>
          )}
          <button
            className="nf-button"
            disabled={busy}
            onClick={async () => {
              onBusy(true);
              try {
                onChange(await service.load());
                onError("");
              } catch (e) {
                onError(e instanceof Error ? e.message : "Falha ao atualizar.");
              } finally {
                onBusy(false);
              }
            }}
          >
            Atualizar histórico
          </button>
        </div>
        {connection?.details.warning && (
          <p className="nf-alert">{connection.details.warning}</p>
        )}
        {connection?.details.cnc && (
          <p className="nf-alert">
            CNC consultado:{" "}
            {connection.details.cnc.municipalRegistration === null
              ? "sem registro complementar neste ambiente. A inscrição municipal será omitida nas novas DPS e mantida no cadastro da empresa."
              : "registro complementar localizado. A inscrição municipal será incluída conforme o cadastro confirmado."}
            {!fresh &&
              " A consulta será atualizada antes do preparo e do envio."}
          </p>
        )}
        {state.canIssue && (
          <div className="nf-homologation-actions">
            <label className="nf-field">
              <span>Rascunho salvo para teste</span>
              <select
                value={selection}
                onChange={(e) => {
                  setSelection(e.target.value);
                  setConfirming(null);
                }}
                disabled={busy}
              >
                <option value="">Selecione uma nota</option>
                {state.drafts.map((d) => (
                  <option value={d.payload.id} key={d.payload.id}>
                    {d.payload.customerName} ·{" "}
                    {d.payload.amount
                      ? fmt(parseMoney(d.payload.amount))
                      : "valor pendente"}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="nf-button nf-primary"
              disabled={
                busy ||
                !saved ||
                Boolean(pending && pending.status !== "failed")
              }
              onClick={() =>
                saved &&
                run({
                  action: "prepare",
                  draftId: saved.payload.id,
                  draftRevision: saved.revision,
                  configRevision: state.configRevision,
                })
              }
            >
              <FileCheck2 />
              Preparar DPS de teste
            </button>
          </div>
        )}
        {busy && (
          <p role="status">
            Processando no serviço seguro… aguarde antes de repetir a operação.
          </p>
        )}
        {state.emissions.length === 0 && (
          <p>
            Salve um rascunho com os dados completos do cliente e do serviço
            para preparar o primeiro teste.
          </p>
        )}
        {state.emissions.map((e) => {
          const d = state.drafts.find(
            (d) => d.payload.id === e.draftId,
          )?.payload;
          return (
            <article className="nf-homologation-record" key={e.id}>
              <div className="nf-homologation-actions">
                <div>
                  <b>{d?.customerName || "Cliente do teste"}</b>
                  <p>
                    Série {String(e.series).padStart(5, "0")} · DPS {e.number} ·{" "}
                    {labels[e.status] || e.status}
                  </p>
                  <small>{e.dpsId}</small>
                </div>
                <div className="nf-row-actions">
                  {e.status === "rejected" &&
                    d &&
                    !state.emissions.some(
                      (other) =>
                        other.draftId === e.draftId &&
                        [
                          "preparing",
                          "prepared",
                          "sending",
                          "unknown",
                          "authorized",
                        ].includes(other.status),
                    ) && (
                      <button
                        className="nf-button"
                        disabled={busy}
                        onClick={() => onEditDraft(d)}
                      >
                        <Pencil /> Editar rascunho
                      </button>
                    )}
                  {[
                    "prepared",
                    "authorized",
                    "sending",
                    "unknown",
                    "rejected",
                  ].includes(e.status) && (
                    <button
                      className="nf-button"
                      disabled={busy}
                      onClick={() => download(e, "xml")}
                    >
                      <Download />
                      XML
                    </button>
                  )}
                  {e.status === "authorized" && (
                    <button
                      className="nf-button"
                      disabled={busy}
                      onClick={() => download(e, "mirror")}
                    >
                      <Download /> Espelho em PDF
                    </button>
                  )}
                  {e.status === "authorized" && (
                    <button
                      className="nf-button"
                      disabled={busy}
                      onClick={() => download(e, "pdf")}
                    >
                      DANFSe de teste
                    </button>
                  )}
                  {state.canIssue &&
                    ["sending", "unknown"].includes(e.status) && (
                      <button
                        className="nf-button"
                        disabled={busy}
                        onClick={() => run({ action: "reconcile", id: e.id })}
                      >
                        Consultar resultado
                      </button>
                    )}
                  {state.canIssue && e.status === "prepared" && (
                    <button
                      className="nf-button nf-primary"
                      disabled={busy}
                      onClick={() => setConfirming(e.id)}
                    >
                      <Send />
                      Revisar envio
                    </button>
                  )}
                  {state.canIssue &&
                    e.status === "unknown" &&
                    e.errors.some((error) => error.code === "E2404") && (
                      <button
                        className="nf-button"
                        disabled={busy}
                        onClick={() => setConfirming("resume:" + e.id)}
                      >
                        Revisar nova tentativa
                      </button>
                    )}
                </div>
              </div>
              {documentStatus?.id === e.id && (
                <p
                  className={`nf-alert${documentStatus.state === "error" ? " nf-error" : ""}`}
                  role={documentStatus.state === "error" ? "alert" : "status"}
                >
                  {documentStatus.message}
                  {documentStatus.state === "success" && documentStatus.url && (
                    <>
                      {" "}
                      <a
                        href={documentStatus.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Abrir PDF
                      </a>
                    </>
                  )}
                </p>
              )}
              {state.canIssue && e.status === "prepared" && (
                <button
                  className="nf-button"
                  disabled={busy}
                  onClick={() => setConfirming("discard:" + e.id)}
                >
                  Descartar DPS preparada
                </button>
              )}
              {e.errors.length > 0 && (
                <ul>
                  {e.errors.map((error, i) => (
                    <li key={i}>
                      {error.code}: {error.message}
                    </li>
                  ))}
                </ul>
              )}
              {confirming === e.id && (
                <div className="nf-alert nf-send-confirm">
                  <div>
                    <b>Confirmar envio de teste?</b>
                    <p>
                      Cliente: {d?.customerName} · Documento:{" "}
                      {d?.customerDocument} · Valor:{" "}
                      {fmt(parseMoney(d?.amount || "0"))}. Competência:{" "}
                      {d?.serviceDate}. Serviço: {d?.description}.
                    </p>
                    <p>
                      Este envio usa o A1 da empresa no ambiente de homologação.
                      Confira o XML antes de confirmar. Nenhuma nota de produção
                      será emitida.
                    </p>
                    <div className="nf-row-actions">
                      <button
                        className="nf-button"
                        disabled={busy}
                        onClick={() => setConfirming(null)}
                      >
                        Voltar à revisão
                      </button>
                      <button
                        className="nf-button nf-primary"
                        disabled={busy}
                        onClick={() =>
                          run({
                            action: "send",
                            id: e.id,
                            confirmation: "ENVIAR HOMOLOGACAO",
                          })
                        }
                      >
                        Confirmar envio em homologação
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {confirming === "discard:" + e.id && (
                <div className="nf-alert">
                  <div>
                    <b>Descartar esta DPS antes do envio?</b>
                    <p>
                      A numeração fica preservada no histórico. Você poderá
                      editar e salvar o rascunho para preparar outra DPS. Isso
                      não cancela uma nota fiscal.
                    </p>
                    <button
                      className="nf-button"
                      disabled={busy}
                      onClick={() => setConfirming(null)}
                    >
                      Manter DPS
                    </button>
                    <button
                      className="nf-button nf-danger"
                      disabled={busy}
                      onClick={() =>
                        run({
                          action: "discard",
                          id: e.id,
                          confirmation: "DESCARTAR DPS",
                        })
                      }
                    >
                      Confirmar descarte sem envio
                    </button>
                  </div>
                </div>
              )}
              {confirming === "resume:" + e.id && (
                <div className="nf-alert nf-send-confirm">
                  <div>
                    <b>Liberar nova tentativa com a mesma DPS?</b>
                    <p>
                      O sistema consultará o governo novamente. Se a nota
                      continuar ausente, a mesma DPS voltará para revisão,
                      preservando número, dados e XML. Nenhum envio será feito
                      nesta etapa.
                    </p>
                    <button
                      className="nf-button"
                      disabled={busy}
                      onClick={() => setConfirming(null)}
                    >
                      Manter pendente
                    </button>
                    <button
                      className="nf-button nf-primary"
                      disabled={busy}
                      onClick={() =>
                        run({
                          action: "resume",
                          id: e.id,
                          confirmation: "RETOMAR DPS",
                        })
                      }
                    >
                      Confirmar liberação da mesma DPS
                    </button>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
