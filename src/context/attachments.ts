import type { GetDialogs } from "../ui/dialogs";
import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import * as path from "node:path";
import { safePath } from "../policy/policy";
export interface Attachment {
  id: string;
  label: string;
  path?: string;
  text: string;
}
export class Attachments {
  private rows: Attachment[] = [];
  constructor(private getDialogs?: GetDialogs) {}
  list() {
    return this.rows.map(({ text, ...row }) => row);
  }
  peek() {
    return this.rows.map((row) => ({ ...row }));
  }
  consume() {
    const rows = this.rows;
    this.rows = [];
    return rows;
  }
  remove(id: string) {
    this.rows = this.rows.filter((r) => r.id !== id);
  }
  async choose(uri?: vscode.Uri) {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) throw new Error("Open a workspace first.");
    if (uri) {
      const info = await vscode.workspace.fs.stat(uri);
      if (info.type === vscode.FileType.Directory) {
        const files = await vscode.workspace.findFiles(
          new vscode.RelativePattern(uri, "**/*"),
          "**/{node_modules,.git,dist,.env,.env.*}/**",
          50,
        );
        for (const file of files) await this.file(root, file);
        return;
      }
      return this.file(root, uri);
    }
    const editor = vscode.window.activeTextEditor;
    const selection =
      editor && !editor.selection.isEmpty
        ? {
            relative: path.relative(root, editor.document.uri.fsPath),
            line: editor.selection.start.line + 1,
            text: editor.document.getText(editor.selection),
          }
        : undefined;
    const ui = await this.getDialogs?.();
    if (!ui) return;
    const choice = await ui.pick(
      "Add context",
      ["File", "Selection", "Folder", "Diagnostics"].map((value) => ({
        label: value,
        value,
      })),
    );
    if (!choice) return;
    if (choice === "Selection") {
      if (!selection) throw new Error("Select text in the editor first.");
      const { relative, line, text } = selection;
      await safePath(root, relative);
      this.add({ label: `${relative}:${line}`, path: relative, text });
      return;
    }
    if (choice === "Diagnostics") {
      const rows = [];
      for (const [uri, items] of vscode.languages.getDiagnostics()) {
        const relative = path.relative(root, uri.fsPath);
        try {
          await safePath(root, relative);
        } catch {
          continue;
        }
        rows.push({
          path: relative,
          items: items.map((d) => ({
            line: d.range.start.line + 1,
            message: d.message,
          })),
        });
      }
      this.add({ label: "Diagnostics", text: JSON.stringify(rows) });
      return;
    }
    if (choice === "Folder") {
      let folder = root;
      while (true) {
        const entries = await vscode.workspace.fs.readDirectory(
          vscode.Uri.file(folder),
        );
        const choices = [
          {
            label: "Use this folder",
            description: path.relative(root, folder) || ".",
            value: folder + "/",
          },
        ];
        if (folder !== root)
          choices.push({
            label: "Parent folder",
            description: "..",
            value: path.dirname(folder),
          });
        for (const [name, type] of entries
          .sort(([a], [b]) => a.localeCompare(b))
          .slice(0, 1000)) {
          if (
            type !== vscode.FileType.Directory ||
            ["node_modules", ".git", "dist"].includes(name)
          )
            continue;
          const next = path.join(folder, name);
          try {
            await safePath(root, path.relative(root, next));
            choices.push({ label: name, description: "Folder", value: next });
          } catch {
            /* Keep protected paths out of the picker. */
          }
        }
        const selected = await ui.pick("Select folder", choices);
        if (!selected) return;
        if (selected === folder + "/") break;
        folder = selected;
      }
      const files = await vscode.workspace.findFiles(
        new vscode.RelativePattern(vscode.Uri.file(folder), "**/*"),
        "**/{node_modules,.git,dist,.env,.env.*}/**",
        51,
      );
      let included = 0;
      for (const file of files.slice(0, 50)) {
        try {
          await this.file(root, file);
          included++;
        } catch {
          /* Report omissions without expanding the context budget. */
        }
      }
      if (included < files.length)
        await ui.notice(
          "Some folder files were omitted: protected, oversized, binary, or attachment limit.",
        );
      return;
    }
    const files = await vscode.workspace.findFiles(
      new vscode.RelativePattern(root, "**/*"),
      "**/{node_modules,.git,dist,.env,.env.*}/**",
      1000,
    );
    const selected = await ui.pick(
      "Select file",
      files.map((uri) => ({
        label: path.relative(root, uri.fsPath),
        value: uri,
      })),
      "Up to 1,000 workspace files. Use Folder to browse a specific directory.",
    );
    if (selected) await this.file(root, selected);
  }
  private add(row: Omit<Attachment, "id">) {
    if (
      this.rows.length >= 50 ||
      this.rows.reduce((n, r) => n + Buffer.byteLength(r.text), 0) +
        Buffer.byteLength(row.text) >
        65536
    )
      throw new Error("Attachment limit: 50 items / 64 KB.");
    this.rows.push({ ...row, id: randomUUID() });
  }
  private async file(root: string, uri: vscode.Uri) {
    const relative = path.relative(root, uri.fsPath);
    await safePath(root, relative);
    const info = await vscode.workspace.fs.stat(uri);
    if (info.size > 65536)
      throw new Error("File context exceeds 64 KB. Select a smaller range.");
    const doc = await vscode.workspace.openTextDocument(uri);
    const text = doc.getText();
    if (text.includes("\0"))
      throw new Error("Binary context is not supported.");
    this.add({ label: relative, path: relative, text });
  }
}
