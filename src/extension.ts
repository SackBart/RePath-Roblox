import * as vscode from 'vscode';
import { convertToRobloxPath } from './PathResolver';

export function activate(context: vscode.ExtensionContext) {
	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Active');

	const disposable = vscode.commands.registerCommand('extension.helloWorld', () => {



		vscode.window.showInformationMessage('Hello World!');
	});

	context.subscriptions.push(disposable);

	vscode.workspace.onDidRenameFiles(async (e) => {
		const workspaceEdit = new vscode.WorkspaceEdit();
		let changeCount = 0;

		for (const file of e.files) {
			if (!file.oldUri.fsPath.match(/\.luau?$/)) { continue; }

			const oldRobloxPath = convertToRobloxPath(file.oldUri.fsPath);
			const newRobloxPath = convertToRobloxPath(file.newUri.fsPath);

			if (oldRobloxPath && newRobloxPath && oldRobloxPath != newRobloxPath) {
				console.log(`Refactor: ${oldRobloxPath} -> ${newRobloxPath}`);

				changeCount += await performRefactoring(oldRobloxPath, newRobloxPath, workspaceEdit);
			}
		}

		if (changeCount > 0) {
			await vscode.workspace.applyEdit(workspaceEdit);
			vscode.window.showInformationMessage(`Refactoring: ${changeCount} paths updated`);
		}
	})
}

async function performRefactoring(
	oldPath: string,
	newPath: string,
	edit: vscode.WorkspaceEdit
): Promise<number> {
	const files = await vscode.workspace.findFiles('**/*.{lua.luau}', '**/node_modules/**');
	let count = 0;

	const escapedOldPath = oldPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

	const regex = new RegExp(escapedOldPath, 'g')

	for (const fileUri of files) {
		try {
			const document = await vscode.workspace.openTextDocument(fileUri);
			const text = document.getText();

			let match;
			while ((match = regex.exec(text)) !== null) {
				const startPos = document.positionAt(match.index);
				const endPos = document.positionAt(match.index + match[0].length);

				// Validierung: Prüfen, ob das Zeichen DANACH ein Punkt oder Buchstabe ist.
				// Wenn wir "Module" ersetzen, wollen wir nicht "Module2" ersetzen.
				const charAfter = text.charAt(match.index + match[0].length);
				if (/[a-zA-Z0-9_]/.test(charAfter)) {
					continue; // Es ist Teil eines längeren Namens, überspringen
				}

				edit.replace(fileUri, new vscode.Range(startPos, endPos), newPath);
				count++;
			}
		} catch (err) {
			console.error(err);
		}
	}
	return count;
}
