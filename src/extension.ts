import * as vscode from 'vscode';
import { convertToRobloxPath } from './PathResolver';
import * as path from 'path';
import * as ignoreManager from './IgnoreManager';
import { createIgnoreFile } from './IgnoreFileCreator';

/**
 * Activates the RePath extension.
 * 
 * @param _context - VS Code extension context (unused but required by API)
 * 
 * @remarks
 * This extension automatically updates require() paths in Lua/Luau files
 * when module scripts are moved or renamed in a Roblox project.
 */
export function activate(_context: vscode.ExtensionContext) {
	console.log('RePath Is Online');

	let disposable = vscode.commands.registerCommand('repath.createIgnore', () => {
		createIgnoreFile();
	})
	context.subscriptions.push(disposable);

	vscode.workspace.onDidRenameFiles(async (e) => {
		// We have a file changed its name or got its parent changed
		// Implying that a file exists
		vscode.window.showInformationMessage("RePath: Starting to refactor...");
		const workspaceEdit = new vscode.WorkspaceEdit();

		const workspaceFolder = await vscode.workspace.getWorkspaceFolder(e.files[0].oldUri);

		let changeCount = 0;

		for (const file of e.files) {
			if (!file.oldUri.fsPath.match(/\.luau?$/)) { continue; }

			if (!workspaceFolder) {
				console.log("[RePath] Not within the workspace folder");
				vscode.window.showErrorMessage("RePath: Not within the workspace folder");
				continue;
			}

			const relativePathOld = path.relative(workspaceFolder.uri.fsPath, file.oldUri.fsPath);
			const relativePathNew = path.relative(workspaceFolder.uri.fsPath, file.newUri.fsPath);

			const normalizedOld = relativePathOld.replace(/\\/g, '/');
			const normalizedNew = relativePathNew.replace(/\\/g, '/');

			const oldRobloxPath = convertToRobloxPath(normalizedOld, workspaceFolder);
			const newRobloxPath = convertToRobloxPath(normalizedNew, workspaceFolder);

			if (oldRobloxPath && newRobloxPath && oldRobloxPath != newRobloxPath) {
				console.log(`[RePath] Refactor: ${oldRobloxPath} -> ${newRobloxPath}`);

				changeCount += await performRefactoring(oldRobloxPath, newRobloxPath, workspaceEdit, workspaceFolder);
			}
		}

		if (changeCount > 0) {
			const success = await vscode.workspace.applyEdit(workspaceEdit);
			if (success) {
				vscode.window.showInformationMessage(`RePath: Applied new path on ${changeCount} file` + (changeCount == 1 ? "" : "s"));
			} else {
				vscode.window.showErrorMessage("RePath: Couldn't refactor the paths");
			}
		}
	});
}

/**
 * Performs refactoring of require() paths across all Lua/Luau files in the workspace.
 * 
 * @param oldPath - The old Roblox path (e.g., game:GetService("ServerScriptService").OldModule)
 * @param newPath - The new Roblox path (e.g., game:GetService("ReplicatedStorage").NewModule)
 * @param edit - VS Code workspace edit to accumulate changes
 * @returns Number of files that were modified
 * 
 * @remarks
 * This function handles two cases:
 * 1. Variable-based requires: local SSS = game:GetService("ServerScriptService"); require(SSS.Module)
 * 2. Direct requires: require(game:GetService("ServerScriptService").Module)
 * 
 * The function intelligently reuses existing service variables when possible.
 */
async function performRefactoring(
	oldPath: string,
	newPath: string,
	edit: vscode.WorkspaceEdit,
	workspaceFolder: vscode.WorkspaceFolder
): Promise<number> {
	const files = await vscode.workspace.findFiles('**/*.{lua,luau}', '**/node_modules/**');

	let count = 0;

	const ignoreList = await ignoreManager.getIgnore(workspaceFolder);

	for (const fileUri of files) {
		console.log(`[RePath] Looking at file ${fileUri.fsPath}`);

		const rawRelativePath = path.relative(workspaceFolder.uri.fsPath, fileUri.fsPath);
		const relativePathPosix = rawRelativePath.split(path.sep).join(path.posix.sep);
		console.log(`Check ignore for: ${relativePathPosix}`);

		if (ignoreList.ignores(relativePathPosix)) {
			console.log(`[RePath] ${fileUri.fsPath} is excluded`);
			continue;
		}

		const document = await vscode.workspace.openTextDocument(fileUri);
		const text = document.getText();

		// Get the services and the path suffixes from the given paths
		const serviceRegex = /^game:GetService\("([^"]+)"\)(.*)$/;
		const matchOld = oldPath.match(serviceRegex);
		const matchNew = newPath.match(serviceRegex);

		if (!matchOld || !matchNew) {
			console.error("[RePath] Path is not in correct Format");
			continue;
		}

		const oldServiceName = matchOld[1];
		const oldPathSuffix = matchOld[2];
		const newServiceName = matchNew[1];
		const newPathSuffix = matchNew[2];

		// Get the variables that require the services
		const oldServiceRegex = new RegExp(`local\\s+([a-zA-Z_]\\w*)\\s*=\\s*game:GetService\\("${oldServiceName}"\\)`);
		const newServiceRegex = new RegExp(`local\\s+([a-zA-Z_]\\w*)\\s*=\\s*game:GetService\\("${newServiceName}"\\)`);

		const matchOldVariable = oldServiceRegex.exec(text);
		const matchNewVariable = newServiceRegex.exec(text);

		let oldServiceVariable;
		let newServiceVariable;

		if (matchOldVariable) {
			oldServiceVariable = matchOldVariable[1];
		}
		if (matchNewVariable) {
			newServiceVariable = matchNewVariable[1];
		}

		// Look for the path that contains oldVariable.oldPathSuffix or game:GetService("oldServiceName").oldPathSuffix
		if (oldServiceVariable != null && text.includes(oldServiceVariable + oldPathSuffix)) { // Case 1: Variable requiring Service which is then used inside require() 
			// Old Variable has been used
			// Replace path
			const oldGivenPath = oldServiceVariable + oldPathSuffix;
			const fullRange = new vscode.Range(
				document.positionAt(0),
				document.positionAt(text.length)
			);
			if (oldServiceVariable == newServiceVariable) {
				// Keep the old variable
				const newText = text.replaceAll(oldGivenPath, oldServiceVariable + newPathSuffix);
				edit.replace(fileUri, fullRange, newText);
			} else if (newServiceVariable) {
				// Replace it with the new one since it's a new service
				const newText = text.replaceAll(oldGivenPath, newServiceVariable + newPathSuffix);
				edit.replace(fileUri, fullRange, newText);
			} else {
				// Directly require the service and include the path suffix
				const newText = text.replaceAll(oldGivenPath, `game:GetService("${newServiceName}")` + newPathSuffix);
				edit.replace(fileUri, fullRange, newText);
			}
			count++;
			console.log("[RePath] Successfully changed path");
		} else if (text.includes(oldPath)) { // Case 2: Directly required
			// Old Variable has been used
			// Replace path
			const fullRange = new vscode.Range(
				document.positionAt(0),
				document.positionAt(text.length)
			);
			if (oldServiceVariable == newServiceVariable && oldServiceVariable != null && newServiceVariable != null) {
				// Keep the old variable
				const newText = text.replaceAll(oldPath, oldServiceVariable + newPathSuffix);
				edit.replace(fileUri, fullRange, newText);
			} else if (newServiceVariable) {
				// Replace it with the new one since it's a new service
				const newText = text.replaceAll(oldPath, newServiceVariable + newPathSuffix);
				edit.replace(fileUri, fullRange, newText);
			} else {
				// Directly require the service and include the path suffix
				const newText = text.replaceAll(oldPath, `game:GetService("${newServiceName}")` + newPathSuffix);
				edit.replace(fileUri, fullRange, newText);
			}
			count++;
			console.log("[RePath] Successfully changed path");
		} else {
			console.log("[RePath] Didn't find it. Continuing");
		}
	}

	return count;
}