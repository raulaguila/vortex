import { FileGrant, CommandGrant } from "./planAuthorization";
import type { GetDialogs } from "./dialogs";
import type { Change } from "./changes";
import * as path from "node:path";
import * as vscode from "vscode";
import { ApprovalDenied, validateAction } from "./actions";
import { runCommandDetailed } from "./command";
import { EditorContext, editorContextCoverage } from "./editorContext";
import { ExecutionError } from "./execution";
import { FileSnapshot, snapshotFile, verifySnapshot } from "./files";
import { applyEdits } from "./multiEdit";
import {
  Mode,
  Permission,
  canWrite,
  isMode,
  isPermission,
  safePath,
} from "./policy";
import { InteractionReply, Response } from "./protocol";
import { ProviderManager } from "./providerManager";
import { Interactions } from "./interaction";
import { contentVersion, executeReadTool } from "./readTools";
import { ReviewService } from "./review";
import { Sandbox } from "./sandbox";
import { SessionStore } from "./sessions";

import { AgentRuntime } from "./agentRuntime";
export class AgentController extends AgentRuntime {
  private interactions = new Interactions((message) => this.post(message));
  respondInteraction(reply: InteractionReply) {
    return this.interactions.respond(reply);
  }
  override history(post = this.post) {
    super.history(post);
    this.interactions.snapshot(post);
  }
  override dispose() {
    super.dispose();
    this.interactions.dispose();
  }
  constructor(
    providers: ProviderManager,
    post: (message: Response) => void,
    sessions: SessionStore,
    reviews?: ReviewService,
    artifactsDirectory?: string,
    editor?: EditorContext,
    tracePath?: string,
    getDialogs?: GetDialogs,
  ) {
    super(
      providers,
      post,
      sessions,
      reviews,
      artifactsDirectory,
      editor,
      tracePath,
      {
        trusted: () => vscode.workspace.isTrusted,
        roots: () =>
          vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath) || [],
        pickRoot: async () =>
          getDialogs
            ? (await getDialogs()).pick(
                "Choose this task’s workspace root",
                (vscode.workspace.workspaceFolders || []).map((f) => ({
                  label: f.name,
                  description: f.uri.fsPath,
                  value: f.uri.fsPath,
                })),
              )
            : undefined,
        choosePermission: async () =>
          getDialogs
            ? (await getDialogs()).pick<Permission>(
                "Implement plan — permission",
                [
                  {
                    label: "Supervised",
                    description:
                      "Ask before applying edits and running commands.",
                    value: "supervised",
                  },
                  {
                    label: "Autonomous",
                    description:
                      "Apply edits automatically; host commands still require approval.",
                    value: "autonomous",
                  },
                ],
              )
            : undefined,
        confirmUncertain: async () =>
          getDialogs
            ? (await getDialogs()).confirm(
                "Review the interrupted operation before continuing.",
                "Inspect the workspace and task changes before continuing. The interrupted operation will not be repeated automatically.",
                "I reviewed the result — continue",
              )
            : false,
        execute: async () => {
          throw new Error("Host tool dispatcher unavailable.");
        },
      },
    );
  }
  protected override async workspaceFingerprint(root?: string) {
    if (vscode.workspace.textDocuments?.some((d) => d.isDirty)) return null;
    return super.workspaceFingerprint(root);
  }
  protected override async planExecutionLocation(
    permission: Permission,
  ): Promise<"host" | "sandbox"> {
    const image =
      vscode.workspace
        .getConfiguration?.("vortex")
        .get<string>("sandbox.image") || "node:22-bookworm-slim";
    return permission === "autonomous" && (await new Sandbox().available(image))
      ? "sandbox"
      : "host";
  }
  protected override async preparePlanScope(permission: Permission) {
    await super.preparePlanScope(permission);
    const root = this.session!.root;
    if (!root)
      throw new Error("Open a workspace before creating an executable plan.");
    for (const scope of this.session!.plan!.authorization!.steps) {
      for (const f of scope.files) await safePath(root, f.path);
      for (const c of scope.commands)
        if (c.cwd !== ".") await safePath(root, c.cwd);
    }
  }
  private async mutateWithoutReview(
    file: string,
    apply: () => Promise<void>,
    save: () => Promise<void>,
  ) {
    try {
      await apply();
      await save();
    } catch {
      throw new ExecutionError(
        "uncertain_outcome",
        "Operation on " +
          file +
          " may have changed the workspace. Review before continuing.",
      );
    }
  }
  protected verifyRead(
    snapshot: FileSnapshot,
    relativePath = path.basename(snapshot.path),
  ) {
    const previous = this.readVersions.get(snapshot.path);
    if (this.run && snapshot.content !== null && !previous)
      throw new Error(
        "Read the existing file in the current turn before changing it. Call read_file with " +
          JSON.stringify({ path: relativePath }) +
          ". Reads from earlier turns are not current snapshots. Do not retry edit_file or write_file until that read succeeds.",
      );
    if (
      previous &&
      (snapshot.content === null ||
        previous !== contentVersion(snapshot.content))
    )
      throw new Error(
        "File changed since your last read. Read it again before editing.",
      );
  }
  protected async execute(
    input: unknown,
    mode: Mode,
    root: string | undefined,
    signal: AbortSignal,
    permission: Permission = "supervised",
    expected?: FileSnapshot,
    prepared?: Change,
  ): Promise<string> {
    signal.throwIfAborted();
    if (!isMode(mode) || !isPermission(permission))
      throw new Error("Invalid execution policy.");
    const a = validateAction(input, mode);
    if (
      a.action === "propose_plan" ||
      a.action === "report_step_result" ||
      a.action === "read_tool_output"
    )
      return super.execute(a, mode, root, signal, permission);
    if (a.action === "ask_user") {
      const reply = await this.approval(
        () =>
          this.interactions.request(
            {
              kind: "question",
              runId: this.progress?.runId || "tool",
              question: a.question,
              options: a.options,
              recommended_option: a.recommended_option,
            },
            signal,
            undefined,
            (data) =>
              this.event(
                "assistant",
                a.question,
                undefined,
                undefined,
                undefined,
                data.id,
              ),
          ),
        "Waiting for your answer",
        "question",
      );
      if (reply.decision !== "answer")
        throw new ApprovalDenied(
          "Question cancelled. Task paused without further actions.",
        );
      this.event("user", reply.answer!);
      return reply.answer!;
    }
    if (!root) throw new Error("Abra uma pasta no VS Code.");
    if (a.action === "get_editor_context")
      return JSON.stringify(
        this.editor
          ? await this.editor.snapshot(root, a.include_selection)
          : {
              ...editorContextCoverage,
              files: [],
              active: null,
              unavailable: true,
            },
      );
    const readResult = await executeReadTool(
      a,
      root,
      signal,
      this.readVersions,
    );
    if (readResult !== undefined) return readResult;
    if (a.action === "edit_file" || a.action === "edit_file_batch") {
      if (!canWrite(mode)) throw new Error("Read-only mode.");
      const snapshot = await snapshotFile(root, a.path);
      const original = snapshot.content;
      if (original === null) throw new Error("File not found.");
      this.verifyRead(snapshot, a.path);
      return this.execute(
        {
          action: "write_file",
          path: a.path,
          content: applyEdits(
            original,
            a.action === "edit_file"
              ? [{ old_text: a.old_text, new_text: a.new_text }]
              : a.edits,
          ),
        },
        mode,
        root,
        signal,
        permission,
        snapshot,
      );
    }
    if (!canWrite(mode)) throw new Error("Este modo permite apenas leitura.");
    if (a.action === "write_file") {
      if (typeof a.content !== "string" || a.content.length > 200000)
        throw new Error("Conteúdo inválido ou maior que 200 KB.");
      const snapshot = expected || (await snapshotFile(root, a.path));
      const file = snapshot.path;
      this.verifyRead(snapshot, a.path);
      const change =
        prepared ||
        (this.session && this.reviews
          ? await this.reviews.propose(
              this.session.id,
              a.path,
              snapshot.content,
              a.content,
            )
          : undefined);
      let partial = false;
      const grant: FileGrant = {
        path: a.path,
        operation: snapshot.content === null ? "create" : "edit",
      };
      if (
        this.planScope()
          ? !this.planAuthorized(grant)
          : permission === "supervised"
      ) {
        const approval = await this.approval(() =>
          this.interactions.request(
            {
              kind: "approval",
              runId: this.progress?.runId || "tool",
              operation: snapshot.content === null ? "create" : "edit",
              path: a.path,
              preview: !!change,
              hunks: change ? this.reviews!.approvalHunks(change) : undefined,
              detail: this.planScope()
                ? "Authorize this file operation for the active plan step. Further operations of the same kind on this path will not ask again."
                : change
                  ? undefined
                  : a.content.slice(0, 12000),
            },
            signal,
            change ? () => this.reviews!.preview(change) : undefined,
          ),
        );
        if (approval.decision !== "approve") {
          if (change)
            await this.reviews!.mark(this.session!.id, change.id, "rejected");
          throw new ApprovalDenied();
        }
        signal.throwIfAborted();
        if (approval.hunks && change) {
          const selected = await this.reviews!.applyHunks(
            this.session!.id,
            change,
            approval.hunks,
          );
          if (selected === snapshot.content) {
            await this.reviews!.mark(this.session!.id, change.id, "rejected");
            throw new ApprovalDenied();
          }
          partial = selected !== a.content;
          a.content = selected;
        }
      }
      if (!partial && !this.planAuthorized(grant))
        await this.extendPlanAuthorization(grant);
      signal.throwIfAborted();
      await verifySnapshot(root, a.path, snapshot);
      const uri = vscode.Uri.file(file);
      const edit = new vscode.WorkspaceEdit();
      let exists = true;
      try {
        await vscode.workspace.fs.stat(uri);
      } catch {
        exists = false;
      }
      if (exists) {
        const doc = await vscode.workspace.openTextDocument(uri);
        if (doc.isDirty || doc.getText() !== snapshot.content)
          throw new Error(
            "The file has changed or contains unsaved edits. Read it again before editing.",
          );
        edit.replace(
          uri,
          new vscode.Range(
            doc.positionAt(0),
            doc.positionAt(doc.getText().length),
          ),
          a.content,
        );
      } else {
        edit.createFile(uri, { overwrite: false });
        edit.insert(uri, new vscode.Position(0, 0), a.content);
      }
      signal.throwIfAborted();
      const apply = async () => {
        if (!(await vscode.workspace.applyEdit(edit)))
          throw new Error("Unable to apply edit.");
      };
      const save = async () => {
        const doc = await vscode.workspace.openTextDocument(uri);
        if (!(await doc.save())) throw new Error("Edit applied but not saved.");
      };
      if (change)
        await this.reviews!.mutate(this.session!.id, change, apply, save);
      else await this.mutateWithoutReview(a.path, apply, save);
      this.readVersions.set(file, contentVersion(a.content));
      if (partial)
        throw new ApprovalDenied(
          "Selected changes applied to " +
            a.path +
            ". Remaining changes were rejected; the turn stopped.",
        );
      return "Arquivo salvo: " + a.path;
    }
    if (a.action === "delete_file") {
      const snapshot = expected || (await snapshotFile(root, a.path));
      if (snapshot.content === null) throw new Error("File not found.");
      this.verifyRead(snapshot, a.path);
      const change =
        prepared ||
        (this.session && this.reviews
          ? await this.reviews.propose(
              this.session.id,
              a.path,
              snapshot.content,
              null,
            )
          : undefined);
      const grant: FileGrant = { path: a.path, operation: "delete" };
      if (
        this.planScope()
          ? !this.planAuthorized(grant)
          : permission === "supervised"
      ) {
        const reply = await this.approval(() =>
          this.interactions.request(
            {
              kind: "approval",
              runId: this.progress?.runId || "tool",
              operation: "delete",
              path: a.path,
              detail: this.planScope()
                ? "Authorize deletion of this exact file for the active step."
                : undefined,
              preview: !!change,
            },
            signal,
            change ? () => this.reviews!.preview(change) : undefined,
          ),
        );
        if (reply.decision !== "approve") {
          if (change)
            await this.reviews!.mark(this.session!.id, change.id, "rejected");
          throw new ApprovalDenied();
        }
      }
      if (!this.planAuthorized(grant))
        await this.extendPlanAuthorization(grant);
      signal.throwIfAborted();
      await verifySnapshot(root, a.path, snapshot);
      const uri = vscode.Uri.file(snapshot.path);
      const doc = await vscode.workspace.openTextDocument(uri);
      if (doc.isDirty) throw new Error("Unsaved changes preserved.");
      const edit = new vscode.WorkspaceEdit();
      edit.deleteFile(uri, { recursive: false });
      const apply = async () => {
        if (!(await vscode.workspace.applyEdit(edit)))
          throw new Error("Unable to remove file.");
      };
      if (change)
        await this.reviews!.mutate(
          this.session!.id,
          change,
          apply,
          async () => {},
        );
      else await this.mutateWithoutReview(a.path, apply, async () => {});
      this.readVersions.delete(snapshot.path);
      return "Removed " + a.path;
    }
    if (a.action === "run_command") {
      if (typeof a.command !== "string" || !a.command.trim())
        throw new Error("Comando inválido.");
      const cwd = a.cwd && a.cwd !== "." ? await safePath(root, a.cwd) : root;
      const scoped = this.planScope();
      const existing = scoped?.commands.find(
        (g) =>
          g.command === a.command &&
          g.cwd === (a.cwd || ".") &&
          g.request_network === !!a.request_network,
      );
      const grant: CommandGrant = {
        command: a.command,
        cwd: a.cwd || ".",
        request_network: !!a.request_network,
        execution_location:
          existing?.execution_location ||
          (await this.planExecutionLocation(permission)),
      };
      if (scoped && !this.planAuthorized(grant)) {
        const detail =
          "Expand authorization for this step: " +
          grant.execution_location +
          "; cwd: " +
          grant.cwd +
          "; network: " +
          grant.request_network +
          "\n" +
          a.command +
          (grant.execution_location === "host"
            ? "\nHost commands can affect files beyond the plan file list."
            : "");
        if (
          !this.planAuthorized(grant) &&
          (
            await this.approval(() =>
              this.interactions.request(
                {
                  kind: "approval",
                  runId: this.progress?.runId || "tool",
                  operation: "command",
                  path: cwd,
                  detail,
                  preview: false,
                },
                signal,
              ),
            )
          ).decision !== "approve"
        )
          throw new ApprovalDenied();
        signal.throwIfAborted();
        await this.extendPlanAuthorization(grant);
      }
      if (
        scoped
          ? grant.execution_location === "sandbox"
          : permission === "autonomous"
      ) {
        this.sandbox ??= new Sandbox(
          this.artifactsDirectory && this.session
            ? path.join(this.artifactsDirectory, this.session.id)
            : undefined,
        );
        const image =
          vscode.workspace
            .getConfiguration?.("vortex")
            .get<string>("sandbox.image") || "node:22-bookworm-slim";
        if (await this.sandbox.available(image)) {
          if (
            a.request_network &&
            !this.planAuthorized(grant) &&
            (
              await this.approval(() =>
                this.interactions.request(
                  {
                    kind: "approval",
                    runId: this.progress?.runId || "tool",
                    operation: "network",
                    detail: a.command,
                    preview: false,
                  },
                  signal,
                ),
              )
            ).decision !== "approve"
          )
            throw new ApprovalDenied();
          const result = await this.sandbox.execute(
            root,
            a.cwd && a.cwd !== "."
              ? `cd '${a.cwd.replace(/'/g, "'\\''")}' && ${a.command}`
              : a.command,
            signal,
            this.commandTimeout,
            !!a.request_network,
            image,
            (stream, text) => this.commandOutput(stream, text),
          );
          if (result.failure) {
            if ("commandResult" in result.failure)
              Object.assign(result.failure, {
                commandEvidence: {
                  ...(result.failure as any).commandResult,
                  execution_location: "sandbox",
                  command: a.command,
                  cwd: a.cwd || ".",
                  fingerprint: null,
                },
              });
            try {
              for (const change of result.changes)
                if (this.session && this.reviews)
                  await this.reviews.propose(
                    this.session.id,
                    change.path,
                    change.before,
                    change.after,
                  );
              if (result.changes.length)
                this.event(
                  "activity",
                  "Interrupted sandbox changes\nChanges retained for review; no changes imported.",
                );
            } catch {
              throw new ExecutionError(
                "uncertain_outcome",
                "The interrupted command could not save all review data. Inspect the workspace and diagnostics before continuing.",
              );
            }
            throw result.failure;
          }
          if (result.artifacts.length)
            this.event(
              "activity",
              "Sandbox artifacts\n" + result.artifacts.join("\n"),
            );
          // Validate the whole import before any workspace mutation.
          const proposals = new Map<string, Change>();
          for (const change of result.changes)
            if (this.session && this.reviews)
              proposals.set(
                change.path,
                await this.reviews.propose(
                  this.session.id,
                  change.path,
                  change.before,
                  change.after,
                ),
              );
          for (const change of result.changes) {
            const current = await snapshotFile(root, change.path);
            if (current.content !== change.before)
              throw new ExecutionError(
                "uncertain_outcome",
                "Sandbox import conflict at " +
                  change.path +
                  ". No import started; review retained proposals.",
              );
          }
          const imported: string[] = [];
          try {
            for (const change of result.changes) {
              const current = await snapshotFile(root, change.path);
              if (current.content !== change.before)
                throw new Error(
                  "Sandbox import conflict: " +
                    change.path +
                    ". User changes preserved.",
                );
              if (current.content !== null)
                this.readVersions.set(
                  current.path,
                  contentVersion(current.content),
                );
              await this.execute(
                change.after === null
                  ? { action: "delete_file", path: change.path }
                  : {
                      action: "write_file",
                      path: change.path,
                      content: change.after,
                    },
                mode,
                root,
                signal,
                permission,
                current,
                proposals.get(change.path),
              );
              imported.push(change.path);
            }
          } catch {
            throw new ExecutionError(
              "uncertain_outcome",
              "Sandbox import paused. Imported: " +
                (imported.join(", ") || "none") +
                ". Review remaining proposals before continuing.",
            );
          }
          if (result.error) throw new Error(result.error);
          return JSON.stringify({
            execution_location: "sandbox",
            command: a.command,
            cwd: a.cwd || ".",
            exit_code: 0,
            cancelled: false,
            fingerprint:
              result.testedFingerprint &&
              result.testedFingerprint ===
                (await this.workspaceFingerprint(root))
                ? result.testedFingerprint
                : null,
            output: result.output,
          });
        }
        if (scoped)
          throw new ExecutionError(
            "provider",
            "The approved sandbox is unavailable. Restore it or revise the plan location; no host command was executed.",
          );
        this.event(
          "activity",
          "Sandbox unavailable\nDocker or the configured image is unavailable. This command requires host approval.",
        );
      }
      if (
        !this.planAuthorized(grant) &&
        (
          await this.approval(() =>
            this.interactions.request(
              {
                kind: "approval",
                runId: this.progress?.runId || "tool",
                operation: "command",
                path: cwd,
                detail: a.command,
                preview: false,
              },
              signal,
            ),
          )
        ).decision !== "approve"
      )
        throw new ApprovalDenied();
      signal.throwIfAborted();
      const before = await this.workspaceFingerprint(root);
      try {
        const result = await runCommandDetailed(
          a.command,
          cwd,
          signal,
          this.commandTimeout,
          1024 * 1024,
          (stream, text) => this.commandOutput(stream, text),
        );
        const after = await this.workspaceFingerprint(root);
        return JSON.stringify({
          ...result,
          execution_location: "host",
          command: a.command,
          cwd: a.cwd || ".",
          fingerprint: before && before === after ? after : null,
        });
      } catch (error) {
        if (error instanceof Error && "commandResult" in error)
          Object.assign(error, {
            commandEvidence: {
              ...(error as any).commandResult,
              execution_location: "host",
              command: a.command,
              cwd: a.cwd || ".",
              fingerprint: null,
            },
          });
        throw error;
      }
    }
    throw new Error("Ação desconhecida.");
  }
}
